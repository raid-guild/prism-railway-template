import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import { getDb } from "./db"

type ReconciliationRow = {
  request_id: string
  request_number: number
  request_workflow_key: string
  request_completed_at: string | null
  request_closed_at: string | null
  workflow_run_id: string | null
  run_workflow_key: string | null
  current_step_key: string | null
  run_status: string | null
  run_completed_at: string | null
  workflow_definition_json: string | null
}

type WorkflowStep = {
  key: string
  type: string | null
}

export type TerminalWorkflowProjectionReconciliation = {
  ok: boolean
  outcome: "would_repair" | "repaired" | "noop" | "blocked" | "not_found"
  code: string
  requestNumber: number
  requestId: string | null
  workflowKey: string | null
  workflowRunId: string | null
  previousStepKey: string | null
  terminalStepKey: string | null
  terminalStepCandidates: string[]
  dryRun: boolean
}

function result(
  input: Omit<TerminalWorkflowProjectionReconciliation, "ok"> & { ok?: boolean },
): TerminalWorkflowProjectionReconciliation {
  return {
    ...input,
    ok: input.ok ?? (input.outcome !== "blocked" && input.outcome !== "not_found"),
  }
}

function readWorkflowSteps(definitionJson: string | null): WorkflowStep[] {
  if (!definitionJson) return []
  try {
    const definition = JSON.parse(definitionJson) as { steps?: unknown }
    if (!Array.isArray(definition.steps)) return []
    return definition.steps.flatMap((step) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) return []
      const record = step as Record<string, unknown>
      const key = typeof record.key === "string" ? record.key.trim() : ""
      if (!key) return []
      return [{ key, type: typeof record.type === "string" ? record.type : null }]
    })
  } catch {
    return []
  }
}

function baseResult(input: {
  requestNumber: number
  row?: ReconciliationRow
  dryRun: boolean
  terminalStepCandidates?: string[]
}) {
  return {
    requestNumber: input.requestNumber,
    requestId: input.row?.request_id ?? null,
    workflowKey: input.row?.request_workflow_key ?? null,
    workflowRunId: input.row?.workflow_run_id ?? null,
    previousStepKey: input.row?.current_step_key ?? null,
    terminalStepKey: null,
    terminalStepCandidates: input.terminalStepCandidates ?? [],
    dryRun: input.dryRun,
  }
}

export function reconcileTerminalWorkflowProjection(
  input: {
    requestNumber: number
    terminalStepKey?: string | null
    dryRun?: boolean
    actorType?: string
    actorId?: string | null
    note?: string | null
  },
  db: Database.Database = getDb(),
): TerminalWorkflowProjectionReconciliation {
  const dryRun = input.dryRun !== false
  const row = db.prepare(
    `SELECT
       cr.id AS request_id,
       cr.request_number,
       cr.workflow_key AS request_workflow_key,
       cr.completed_at AS request_completed_at,
       cr.closed_at AS request_closed_at,
       wr.id AS workflow_run_id,
       wr.workflow_key AS run_workflow_key,
       wr.current_step_key,
       wr.status AS run_status,
       wr.completed_at AS run_completed_at,
       w.definition_json AS workflow_definition_json
     FROM change_requests cr
     LEFT JOIN workflow_runs wr ON wr.request_id = cr.id
     LEFT JOIN workflows w ON w.key = cr.workflow_key
     WHERE cr.request_number = ?`,
  ).get(input.requestNumber) as ReconciliationRow | undefined

  if (!row) {
    return result({
      ...baseResult({ requestNumber: input.requestNumber, dryRun }),
      outcome: "not_found",
      code: "CHANGE_REQUEST_NOT_FOUND",
    })
  }

  if (!row.workflow_run_id) {
    return result({
      ...baseResult({ requestNumber: input.requestNumber, row, dryRun }),
      outcome: "blocked",
      code: "WORKFLOW_RUN_NOT_FOUND",
    })
  }
  if (row.run_workflow_key !== row.request_workflow_key) {
    return result({
      ...baseResult({ requestNumber: input.requestNumber, row, dryRun }),
      outcome: "blocked",
      code: "WORKFLOW_KEY_MISMATCH",
    })
  }
  if (row.run_status !== "completed" && row.run_status !== "canceled") {
    return result({
      ...baseResult({ requestNumber: input.requestNumber, row, dryRun }),
      outcome: "blocked",
      code: "WORKFLOW_RUN_NOT_TERMINAL",
    })
  }
  const requestIsTerminal = Boolean(row.request_completed_at || row.request_closed_at)
  if (!requestIsTerminal && row.run_status !== "completed") {
    return result({
      ...baseResult({ requestNumber: input.requestNumber, row, dryRun }),
      outcome: "blocked",
      code: "CHANGE_REQUEST_NOT_TERMINAL",
    })
  }

  const activeAgentRun = db.prepare(
    `SELECT id
     FROM agent_runs
     WHERE request_id = ?
       AND status IN ('queued', 'running')
     LIMIT 1`,
  ).get(row.request_id) as { id: string } | undefined
  if (activeAgentRun) {
    return result({
      ...baseResult({ requestNumber: input.requestNumber, row, dryRun }),
      outcome: "blocked",
      code: "AGENT_RUN_ACTIVE",
    })
  }

  const steps = readWorkflowSteps(row.workflow_definition_json)
  if (!steps.length) {
    return result({
      ...baseResult({ requestNumber: input.requestNumber, row, dryRun }),
      outcome: "blocked",
      code: "WORKFLOW_DEFINITION_INVALID",
    })
  }
  const terminalSteps = steps.filter((step) => step.type === "terminal")
  const terminalStepCandidates = terminalSteps.map((step) => step.key)
  if (!terminalSteps.length) {
    return result({
      ...baseResult({ requestNumber: input.requestNumber, row, dryRun }),
      outcome: "blocked",
      code: "WORKFLOW_TERMINAL_STEP_NOT_FOUND",
    })
  }

  const currentStep = steps.find((step) => step.key === row.current_step_key)
  if (currentStep?.type === "terminal" && requestIsTerminal) {
    return result({
      ...baseResult({ requestNumber: input.requestNumber, row, dryRun, terminalStepCandidates }),
      outcome: "noop",
      code: "WORKFLOW_PROJECTION_ALREADY_TERMINAL",
      terminalStepKey: currentStep.key,
    })
  }

  const requestedTerminalStepKey = input.terminalStepKey?.trim() || null
  const terminalStep = currentStep?.type === "terminal"
    ? requestedTerminalStepKey && requestedTerminalStepKey !== currentStep.key
      ? null
      : currentStep
    : requestedTerminalStepKey
      ? terminalSteps.find((step) => step.key === requestedTerminalStepKey) ?? null
      : terminalSteps.length === 1
        ? terminalSteps[0]
        : null
  if (requestedTerminalStepKey && !terminalStep) {
    return result({
      ...baseResult({ requestNumber: input.requestNumber, row, dryRun, terminalStepCandidates }),
      outcome: "blocked",
      code: "INVALID_TERMINAL_STEP",
      terminalStepKey: requestedTerminalStepKey,
    })
  }
  if (!terminalStep) {
    return result({
      ...baseResult({ requestNumber: input.requestNumber, row, dryRun, terminalStepCandidates }),
      outcome: "blocked",
      code: "TERMINAL_STEP_AMBIGUOUS",
    })
  }

  if (dryRun) {
    return result({
      ...baseResult({ requestNumber: input.requestNumber, row, dryRun, terminalStepCandidates }),
      outcome: "would_repair",
      code: requestIsTerminal
        ? "TERMINAL_WORKFLOW_PROJECTION_DRIFT"
        : "TERMINAL_WORKFLOW_AND_REQUEST_PROJECTION_DRIFT",
      terminalStepKey: terminalStep.key,
    })
  }

  const now = new Date().toISOString()
  const terminalAt = row.run_completed_at ?? row.request_completed_at ?? row.request_closed_at ?? now
  db.transaction(() => {
    db.prepare(
      `UPDATE workflow_runs
       SET current_step_key = ?,
           updated_at = ?,
           completed_at = COALESCE(completed_at, ?)
       WHERE id = ?`,
    ).run(terminalStep.key, now, terminalAt, row.workflow_run_id)

    if (!requestIsTerminal && row.run_status === "completed") {
      db.prepare(
        `UPDATE change_requests
         SET completed_at = COALESCE(completed_at, ?),
             closed_at = COALESCE(closed_at, ?),
             updated_at = ?
         WHERE id = ?`,
      ).run(terminalAt, terminalAt, now, row.request_id)
    }

    db.prepare(
      `INSERT INTO workflow_events (
         id, workflow_run_id, request_id, step_key, event_type, actor_type, actor_id, note, payload_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      row.workflow_run_id,
      row.request_id,
      terminalStep.key,
      "workflow.projection_reconciled",
      input.actorType?.trim() || "service",
      input.actorId?.trim() || null,
      input.note?.trim() || "Reconciled terminal workflow projection without executing workflow steps.",
      JSON.stringify({
        previousStepKey: row.current_step_key,
        terminalStepKey: terminalStep.key,
        workflowRunStatus: row.run_status,
        requestCompletedAt: row.request_completed_at,
        requestClosedAt: row.request_closed_at,
        ...(!requestIsTerminal ? {
          requestProjectionRepaired: true,
          requestCompletedAtAfter: terminalAt,
          requestClosedAtAfter: terminalAt,
        } : {}),
      }),
      now,
    )
  })()

  return result({
    ...baseResult({ requestNumber: input.requestNumber, row, dryRun, terminalStepCandidates }),
    outcome: "repaired",
    code: requestIsTerminal
      ? "TERMINAL_WORKFLOW_PROJECTION_RECONCILED"
      : "TERMINAL_WORKFLOW_AND_REQUEST_PROJECTION_RECONCILED",
    terminalStepKey: terminalStep.key,
  })
}
