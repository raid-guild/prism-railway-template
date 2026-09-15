import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { deterministicRecordingHandoffMigration } from "@/lib/app-core/migrations/036_deterministic_recording_handoff";
import { restoreRecordingSystemDefaultMigration } from "@/lib/app-core/migrations/037_restore_recording_system_default";

test("recording migration does not overwrite an instance-customized workflow", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE workflows (
      key TEXT PRIMARY KEY, name TEXT, description TEXT, version INTEGER,
      definition_json TEXT, system_default INTEGER, enabled INTEGER, updated_at TEXT
    );
    CREATE TABLE hooks (
      key TEXT PRIMARY KEY, description TEXT, system_default INTEGER, updated_at TEXT
    );
    INSERT INTO workflows VALUES (
      'recording-transcript-review-publish', 'Custom', 'RaidGuild custom', 14,
      '{"entrypoint":"portal"}', 0, 1, '2026-01-01'
    );
    INSERT INTO hooks VALUES (
      'recording-transcript-completed', 'Built-in hook', 1, '2026-01-01'
    );
  `);
  db.exec(deterministicRecordingHandoffMigration.sql);
  const workflow = db.prepare("SELECT version, definition_json FROM workflows WHERE key = ?")
    .get("recording-transcript-review-publish") as { version: number; definition_json: string };
  assert.equal(workflow.version, 14);
  assert.equal(JSON.parse(workflow.definition_json).entrypoint, "portal");
  db.close();
});

test("ownership migration restores only the exact deterministic recording built-in", () => {
  const databaseWith = (definition: Record<string, unknown>, version = 4) => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE workflows (
        key TEXT PRIMARY KEY, version INTEGER, definition_json TEXT,
        system_default INTEGER, updated_at TEXT
      );
    `);
    db.prepare("INSERT INTO workflows VALUES (?, ?, ?, 0, '2026-01-01')").run(
      "recording-transcript-review-publish",
      version,
      JSON.stringify(definition),
    );
    db.exec(restoreRecordingSystemDefaultMigration.sql);
    return db;
  };
  const deterministicDefinition = {
    hookProcessing: "deterministic-recording-v1",
    entrypoint: "closed",
    steps: [{ key: "closed", type: "terminal" }],
  };

  const restored = databaseWith(deterministicDefinition);
  assert.equal(
    (restored.prepare("SELECT system_default FROM workflows").get() as { system_default: number }).system_default,
    1,
  );
  restored.close();

  for (const [definition, version] of [
    [{ entrypoint: "closed", steps: [{ key: "closed", type: "terminal" }] }, 4],
    [{ ...deterministicDefinition, entrypoint: "publish" }, 4],
    [{ ...deterministicDefinition, steps: [{ key: "closed", type: "terminal" }, { key: "custom", type: "agent" }] }, 4],
    [deterministicDefinition, 14],
  ] as Array<[Record<string, unknown>, number]>) {
    const untouched = databaseWith(definition, version);
    assert.equal(
      (untouched.prepare("SELECT system_default FROM workflows").get() as { system_default: number }).system_default,
      0,
    );
    untouched.close();
  }
});

test("built-in recording hook prepares artifacts and creates one idempotent downstream request", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "prism-recording-handoff-"));
  const previousEnv = {
    dataRoot: process.env.PRISM_AGENT_DATA_ROOT,
    publicBaseUrl: process.env.PRISM_MEMORY_PUBLIC_BASE_URL,
    writeKey: process.env.PRISM_API_WRITE_KEY,
    apiKey: process.env.PRISM_API_KEY,
  };
  process.env.PRISM_AGENT_DATA_ROOT = dataRoot;
  process.env.PRISM_MEMORY_PUBLIC_BASE_URL = "memory.example.test";
  delete process.env.PRISM_API_WRITE_KEY;
  delete process.env.PRISM_API_KEY;

  const appCore = await import("@/lib/app-core");
  const { closeDb, runMigrations } = await import("@/lib/app-core/db");
  const { readRequestArtifactFile } = await import("@/lib/app-core/request-artifact-storage");
  const { isBuiltInRecordingHook, processBuiltInRecordingHook } = await import("@/lib/recording-hook-processing");

  try {
    runMigrations();
    appCore.upsertWorkflow({
      key: "test-recording-publish",
      name: "Test recording publish",
      version: 1,
      definition: {
        key: "test-recording-publish",
        entrypoint: "closed",
        steps: [{ key: "closed", type: "terminal" }],
      },
      enabled: true,
    });
    const builtInHook = appCore.getHookByKey("recording-transcript-completed");
    assert.ok(builtInHook);
    assert.equal(isBuiltInRecordingHook(builtInHook), true);
    appCore.upsertHook({
      key: builtInHook.key,
      name: builtInHook.name,
      description: builtInHook.description,
      enabled: true,
      workflowKey: builtInHook.workflowKey,
      authMode: builtInHook.authMode,
      systemDefault: builtInHook.systemDefault,
      autoRun: builtInHook.autoRun,
      requestTemplate: {
        ...builtInHook.requestTemplate,
        constraints: {
          ...builtInHook.requestTemplate.constraints as Record<string, unknown>,
          recordingWorkflow: {
            downstreamWorkflowKey: "test-recording-publish",
            autoStartDownstream: false,
          },
        },
      },
    });

    const payload = {
      source: "discord-source-adapter",
      event: "recording.summary.completed",
      recording: {
        source: "discord-native",
        sessionId: "session-123",
        title: "Test meeting",
        endedAt: "2026-07-21T18:00:00.000Z",
      },
      transcript: {
        status: "completed",
        textOmitted: true,
        sharingAllowed: false,
      },
      summary: {
        markdown: "# Test meeting\n\nA deterministic summary.",
        json: {
          title: "Test meeting",
          tldr: "A deterministic summary.",
          summary: "The meeting was summarized upstream.",
          actionItems: [],
          tags: ["test"],
        },
        memoryPath: "inbox/memory/incoming/test-summary.json",
        artifactUrl: "/artifacts/test-summary",
      },
      policy: { rawTranscriptSharingAllowed: false },
    };

    const createParent = () => {
      const created = appCore.createChangeRequest({
        title: "Recording transcript completed",
        description: "Prepare deterministic recording artifacts.",
        workflowKey: builtInHook.workflowKey,
        requestType: "content",
        source: `hook:${builtInHook.key}`,
        constraints: {
          recordingWorkflow: {
            downstreamWorkflowKey: "test-recording-publish",
            autoStartDownstream: false,
          },
        },
      });
      assert.ok(created);
      return created;
    };
    const firstParent = createParent();
    const secondParent = createParent();
    const firstProcessing = await processBuiltInRecordingHook({ hook: builtInHook, request: firstParent, payload });
    const secondProcessing = await processBuiltInRecordingHook({ hook: builtInHook, request: secondParent, payload });

    assert.equal(firstProcessing.status, "completed");
    assert.equal(firstProcessing.childRequest?.workflowKey, "test-recording-publish");
    assert.equal(secondProcessing.childRequest?.id, firstProcessing.childRequest?.id);

    const child = firstProcessing.childRequest;
    assert.ok(child);
    const childArtifacts = appCore.listRequestArtifacts(child.id, 100);
    assert.deepEqual(
      new Set(childArtifacts.map((artifact) => artifact.name)),
      new Set([
        "meeting-summary.md",
        "meeting-summary.json",
        "transcript-reference.json",
        "memory-ingest-result.json",
        "downstream-publish-plan.json",
        "workflow-handoff.json",
        `workflow-handoff-attempt-${secondParent.requestNumber}.json`,
      ]),
    );
    const memoryArtifact = childArtifacts.find((artifact) => artifact.name === "memory-ingest-result.json");
    assert.ok(memoryArtifact);
    const memoryResult = JSON.parse((await readRequestArtifactFile(memoryArtifact)).toString("utf8")) as Record<string, unknown>;
    assert.equal(memoryResult.reused, true);
    assert.equal(memoryResult.memoryArtifactUrl, "https://memory.example.test/artifacts/test-summary");

    const parentArtifacts = appCore.listRequestArtifacts(firstParent.id, 100);
    assert.ok(parentArtifacts.some((artifact) => artifact.name === "workflow-handoff.json"));
    assert.equal(appCore.listChangeRequests({ source: child.source }).length, 1);
    assert.ok(childArtifacts.every((artifact) => artifact.metadata.deterministic === true));
    const refreshedChildArtifacts = appCore.listRequestArtifacts(child.id, 100);
    assert.ok(refreshedChildArtifacts.some((artifact) => artifact.name === `workflow-handoff-attempt-${secondParent.requestNumber}.json`));

    const noAutostartParent = appCore.createChangeRequest({
      title: "Recording transcript completed without autostart configuration",
      description: "Prepare deterministic recording artifacts.",
      workflowKey: builtInHook.workflowKey,
      requestType: "content",
      source: `hook:${builtInHook.key}`,
      constraints: {
        recordingWorkflow: {
          downstreamWorkflowKey: "test-recording-publish",
        },
      },
    });
    assert.ok(noAutostartParent);
    const noAutostart = await processBuiltInRecordingHook({
      hook: builtInHook,
      request: noAutostartParent,
      payload: {
        ...payload,
        recording: { ...payload.recording, sessionId: "session-no-autostart" },
      },
    });
    assert.equal(noAutostart.autoStart, null);

    const workflowFile = await readFile(path.resolve(process.cwd(), "workflows/recording-transcript-review-publish/workflow.md"), "utf8");
    assert.match(workflowFile, /deterministic/i);
    assert.doesNotMatch(workflowFile, /steps\/synthesize\.md/);
  } finally {
    closeDb();
    await rm(dataRoot, { recursive: true, force: true });
    if (previousEnv.dataRoot === undefined) delete process.env.PRISM_AGENT_DATA_ROOT;
    else process.env.PRISM_AGENT_DATA_ROOT = previousEnv.dataRoot;
    if (previousEnv.publicBaseUrl === undefined) delete process.env.PRISM_MEMORY_PUBLIC_BASE_URL;
    else process.env.PRISM_MEMORY_PUBLIC_BASE_URL = previousEnv.publicBaseUrl;
    if (previousEnv.writeKey === undefined) delete process.env.PRISM_API_WRITE_KEY;
    else process.env.PRISM_API_WRITE_KEY = previousEnv.writeKey;
    if (previousEnv.apiKey === undefined) delete process.env.PRISM_API_KEY;
    else process.env.PRISM_API_KEY = previousEnv.apiKey;
  }
});
