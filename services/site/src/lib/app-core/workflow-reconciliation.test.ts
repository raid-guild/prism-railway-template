import assert from "node:assert/strict"
import test from "node:test"
import Database from "better-sqlite3"
import { reconcileTerminalWorkflowProjection } from "./workflow-reconciliation"

function testDb() {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE change_requests (
      id TEXT PRIMARY KEY,
      request_number INTEGER NOT NULL UNIQUE,
      workflow_key TEXT NOT NULL,
      completed_at TEXT,
      closed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE workflows (
      key TEXT PRIMARY KEY,
      definition_json TEXT NOT NULL
    );
    CREATE TABLE workflow_runs (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      workflow_key TEXT NOT NULL,
      current_step_key TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE workflow_events (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      step_key TEXT,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      note TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      status TEXT NOT NULL
    );
  `)
  return db
}

function seedDriftedRequest(db: Database.Database, input: {
  requestNumber?: number
  requestCompleted?: boolean
  runStatus?: string
  steps?: Array<Record<string, unknown>>
}) {
  const now = "2026-07-15T14:00:00.000Z"
  const requestNumber = input.requestNumber ?? 4
  db.prepare("INSERT INTO workflows (key, definition_json) VALUES (?, ?)").run(
    "publish",
    JSON.stringify({
      entrypoint: "draft",
      steps: input.steps ?? [
        { key: "draft", type: "agent", next: "publish-prep" },
        { key: "publish-prep", type: "agent", next: "closed" },
        { key: "closed", type: "terminal" },
      ],
    }),
  )
  db.prepare(
    "INSERT INTO change_requests (id, request_number, workflow_key, completed_at, closed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("request-1", requestNumber, "publish", input.requestCompleted === false ? null : now, input.requestCompleted === false ? null : now, now)
  db.prepare(
    `INSERT INTO workflow_runs (
       id, request_id, workflow_key, current_step_key, status, updated_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("run-1", "request-1", "publish", "publish-prep", input.runStatus ?? "completed", now, now)
}

test("terminal projection reconciliation dry-runs, repairs, and is idempotent", () => {
  const db = testDb()
  seedDriftedRequest(db, {})

  const planned = reconcileTerminalWorkflowProjection({ requestNumber: 4 }, db)
  assert.equal(planned.outcome, "would_repair")
  assert.equal(planned.terminalStepKey, "closed")
  assert.equal(db.prepare("SELECT current_step_key FROM workflow_runs").pluck().get(), "publish-prep")

  const repaired = reconcileTerminalWorkflowProjection({
    requestNumber: 4,
    dryRun: false,
    actorType: "service",
    actorId: "repair-test",
    note: "Test repair.",
  }, db)
  assert.equal(repaired.outcome, "repaired")
  assert.equal(db.prepare("SELECT current_step_key FROM workflow_runs").pluck().get(), "closed")
  assert.equal(db.prepare("SELECT status FROM workflow_runs").pluck().get(), "completed")

  const event = db.prepare(
    "SELECT event_type, actor_id, payload_json FROM workflow_events",
  ).get() as { event_type: string; actor_id: string; payload_json: string }
  assert.equal(event.event_type, "workflow.projection_reconciled")
  assert.equal(event.actor_id, "repair-test")
  assert.deepEqual(JSON.parse(event.payload_json), {
    previousStepKey: "publish-prep",
    terminalStepKey: "closed",
    workflowRunStatus: "completed",
    requestCompletedAt: "2026-07-15T14:00:00.000Z",
    requestClosedAt: "2026-07-15T14:00:00.000Z",
  })

  const repeated = reconcileTerminalWorkflowProjection({ requestNumber: 4, dryRun: false }, db)
  assert.equal(repeated.outcome, "noop")
  assert.equal(db.prepare("SELECT COUNT(*) FROM workflow_events").pluck().get(), 1)
  db.close()
})

test("terminal projection reconciliation closes a request whose workflow run already completed", () => {
  const db = testDb()
  seedDriftedRequest(db, { requestCompleted: false })

  const planned = reconcileTerminalWorkflowProjection({ requestNumber: 4 }, db)
  assert.equal(planned.outcome, "would_repair")
  assert.equal(planned.code, "TERMINAL_WORKFLOW_AND_REQUEST_PROJECTION_DRIFT")

  const repaired = reconcileTerminalWorkflowProjection({ requestNumber: 4, dryRun: false }, db)
  assert.equal(repaired.outcome, "repaired")
  assert.equal(repaired.code, "TERMINAL_WORKFLOW_AND_REQUEST_PROJECTION_RECONCILED")
  assert.equal(db.prepare("SELECT current_step_key FROM workflow_runs").pluck().get(), "closed")
  assert.deepEqual(
    db.prepare("SELECT completed_at, closed_at FROM change_requests").get(),
    { completed_at: "2026-07-15T14:00:00.000Z", closed_at: "2026-07-15T14:00:00.000Z" },
  )
  const payload = JSON.parse(db.prepare("SELECT payload_json FROM workflow_events").pluck().get() as string)
  assert.equal(payload.requestProjectionRepaired, true)
  assert.equal(payload.requestCompletedAtAfter, "2026-07-15T14:00:00.000Z")
  db.close()
})

test("terminal projection reconciliation rejects non-terminal runs and active agent runs", () => {
  const db = testDb()
  seedDriftedRequest(db, { requestCompleted: false, runStatus: "active" })
  assert.equal(
    reconcileTerminalWorkflowProjection({ requestNumber: 4, dryRun: false }, db).code,
    "WORKFLOW_RUN_NOT_TERMINAL",
  )

  db.prepare("UPDATE change_requests SET completed_at = ?, closed_at = ?").run("2026-07-15T14:00:00.000Z", "2026-07-15T14:00:00.000Z")
  db.prepare("UPDATE workflow_runs SET status = 'completed'").run()
  db.prepare("INSERT INTO agent_runs (id, request_id, status) VALUES (?, ?, ?)").run("agent-1", "request-1", "running")
  assert.equal(
    reconcileTerminalWorkflowProjection({ requestNumber: 4, dryRun: false }, db).code,
    "AGENT_RUN_ACTIVE",
  )
  db.close()
})

test("terminal projection reconciliation requires an explicit target for multiple terminals", () => {
  const db = testDb()
  seedDriftedRequest(db, {
    steps: [
      { key: "publish-prep", type: "agent", next: "closed" },
      { key: "closed", type: "terminal" },
      { key: "canceled", type: "terminal" },
    ],
  })

  const ambiguous = reconcileTerminalWorkflowProjection({ requestNumber: 4, dryRun: false }, db)
  assert.equal(ambiguous.code, "TERMINAL_STEP_AMBIGUOUS")
  assert.deepEqual(ambiguous.terminalStepCandidates, ["closed", "canceled"])

  const repaired = reconcileTerminalWorkflowProjection({
    requestNumber: 4,
    terminalStepKey: "closed",
    dryRun: false,
  }, db)
  assert.equal(repaired.outcome, "repaired")
  assert.equal(repaired.terminalStepKey, "closed")
  db.close()
})
