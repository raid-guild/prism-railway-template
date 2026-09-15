import { createHash, randomUUID } from "node:crypto";
import {
  buildRequestArtifactStoragePath,
  createChangeRequest,
  createRequestArtifact,
  createWorkflowEvent,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  listChangeRequests,
  updateChangeRequest,
  writeRequestArtifactFile,
  type ChangeRequestRecord,
  type HookRecord,
} from "@/lib/app-core";
import {
  normalizePublicMemoryArtifactUrl,
  promoteMeetingSummaryToMemory,
} from "@/lib/app-core/meeting-memory";

const recordingHookKey = "recording-transcript-completed";
const builtInRecordingWorkflowKey = "recording-transcript-review-publish";

type PreparedArtifact = {
  kind: string;
  name: string;
  description: string;
  mimeType: string;
  content: Buffer;
};

type RecordingWorkflowConfig = {
  downstreamWorkflowKey: string | null;
  autoStartDownstream: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown) {
  return isRecord(value) ? value : {};
}

function recordingConfig(request: ChangeRequestRecord): RecordingWorkflowConfig {
  const config = record(record(request.constraints).recordingWorkflow);
  return {
    downstreamWorkflowKey: text(config.downstreamWorkflowKey ?? config.downstream_workflow_key),
    autoStartDownstream: config.autoStartDownstream === true || config.auto_start_downstream === true,
  };
}

function sourceMetadata(payload: Record<string, unknown>) {
  const capture = record(payload.capture);
  const recording = record(payload.recording);
  const discord = record(payload.discord);
  return {
    kind: text(recording.source) ?? (Object.keys(capture).length ? "browser-capture" : text(payload.source) ?? "other"),
    sessionId: text(recording.sessionId) ?? text(capture.id) ?? text(payload.recordingId),
    title: text(recording.title) ?? text(capture.title),
    startedAt: text(recording.startedAt) ?? text(capture.startedAt),
    endedAt: text(recording.endedAt) ?? text(capture.endedAt) ?? text(payload.occurredAt),
    recordingUrl: text(recording.recordingUrl) ?? text(record(payload.artifacts).recordingURL),
    discord,
  };
}

function markdownFromSummary(summaryJson: Record<string, unknown>, source: ReturnType<typeof sourceMetadata>) {
  const title = text(summaryJson.title) ?? source.title ?? "Meeting summary";
  const tldr = text(summaryJson.tldr);
  const summary = text(summaryJson.summary);
  const lines = [`# ${title}`];
  if (tldr) lines.push("", "## TL;DR", "", tldr);
  if (summary) lines.push("", "## Summary", "", summary);
  return lines.join("\n").trim() + "\n";
}

function jsonArtifact(kind: string, name: string, description: string, value: unknown): PreparedArtifact {
  return {
    kind,
    name,
    description,
    mimeType: "application/json",
    content: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
  };
}

function markdownArtifact(kind: string, name: string, description: string, value: string): PreparedArtifact {
  return {
    kind,
    name,
    description,
    mimeType: "text/markdown",
    content: Buffer.from(value.trimEnd() + "\n", "utf8"),
  };
}

async function saveArtifact(requestId: string, artifact: PreparedArtifact, metadata: Record<string, unknown> = {}) {
  const artifactId = randomUUID();
  const storagePath = buildRequestArtifactStoragePath({ requestId, artifactId, name: artifact.name });
  await writeRequestArtifactFile(storagePath, artifact.content);
  const workflowRun = getWorkflowRunForRequest(requestId);
  const saved = createRequestArtifact({
    id: artifactId,
    requestId,
    workflowRunId: workflowRun?.id ?? null,
    kind: artifact.kind,
    name: artifact.name,
    description: artifact.description,
    mimeType: artifact.mimeType,
    storagePath,
    sizeBytes: artifact.content.byteLength,
    metadata: { ...metadata, deterministic: true },
    createdBy: "recording-hook",
  });
  if (workflowRun) {
    createWorkflowEvent({
      workflowRunId: workflowRun.id,
      requestId,
      stepKey: workflowRun.currentStepKey,
      eventType: "artifact.created",
      actorType: "system",
      payload: {
        artifactId: saved.id,
        kind: saved.kind,
        name: saved.name,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
        deterministic: true,
      },
    });
  }
  return saved;
}

function handoffSource(hook: HookRecord, payload: Record<string, unknown>, workflowKey: string, parentId: string) {
  const source = sourceMetadata(payload);
  const sourceId = source.sessionId ?? parentId;
  const digest = createHash("sha256")
    .update(`${hook.key}:${sourceId}:${workflowKey}`)
    .digest("hex")
    .slice(0, 24);
  return `workflow-handoff:${digest}`;
}

export function isBuiltInRecordingHook(hook: HookRecord) {
  if (hook.key !== recordingHookKey || hook.workflowKey !== builtInRecordingWorkflowKey) return false;
  const workflow = getWorkflowByKey(hook.workflowKey);
  return record(workflow?.definition).hookProcessing === "deterministic-recording-v1";
}

export async function processBuiltInRecordingHook(input: {
  hook: HookRecord;
  request: ChangeRequestRecord;
  payload: Record<string, unknown>;
  baseUrl?: string | null;
}) {
  const { hook, request, payload } = input;
  const summary = record(payload.summary);
  const summaryJson = record(summary.json);
  const source = sourceMetadata(payload);
  const summaryMarkdown = text(summary.markdown) ?? (Object.keys(summaryJson).length ? markdownFromSummary(summaryJson, source) : null);
  const config = recordingConfig(request);

  if (!summaryMarkdown) {
    const blocked = markdownArtifact(
      "recording-processing-blocked",
      "recording-processing-blocked.md",
      "The recording hook could not prepare artifacts deterministically.",
      "# Recording processing blocked\n\nThe hook payload did not contain `summary.markdown` or a usable `summary.json`. The recording source must create the summary before triggering this workflow. Raw transcript text was not promoted or published.",
    );
    await saveArtifact(request.id, blocked, { hookKey: hook.key });
    updateChangeRequest(request.id, {
      workflowStepKey: "closed",
      resolutionSummary: "Deterministic recording processing blocked because the hook payload did not include a completed summary.",
    });
    return { status: "blocked" as const, childRequest: null, autoStart: null };
  }

  const normalizedSummaryJson = Object.keys(summaryJson).length
    ? summaryJson
    : {
        title: source.title ?? "Meeting summary",
        tldr: null,
        summary: summaryMarkdown,
        decisions: [],
        actionItems: [],
        openQuestions: [],
        notableQuotes: [],
        tags: [],
        source: {
          kind: source.kind,
          sessionId: source.sessionId,
          startedAt: source.startedAt,
          endedAt: source.endedAt,
        },
      };
  const transcript = record(payload.transcript);
  const transcriptReference = {
    status: text(transcript.status) ?? "completed",
    textOmitted: transcript.textOmitted !== false,
    sharingAllowed: transcript.sharingAllowed === true || record(payload.policy).rawTranscriptSharingAllowed === true,
    storagePath: text(transcript.storagePath),
    jsonStoragePath: text(transcript.jsonStoragePath),
    artifactUrl: normalizePublicMemoryArtifactUrl(text(transcript.artifactUrl)),
    rawTranscriptIngestSkipped: true,
    source: {
      kind: source.kind,
      sessionId: source.sessionId,
    },
  };

  const existingMemoryPath = text(summary.memoryPath);
  const existingArtifactUrl = normalizePublicMemoryArtifactUrl(text(summary.artifactUrl))
    ?? normalizePublicMemoryArtifactUrl(existingMemoryPath);
  let memoryResult: Record<string, unknown>;
  if (existingMemoryPath || existingArtifactUrl) {
    memoryResult = {
      ok: true,
      reused: true,
      memoryPath: existingMemoryPath,
      memoryArtifactUrl: existingArtifactUrl,
      rawTranscriptIngestSkipped: true,
    };
  } else {
    try {
      const promoted = await promoteMeetingSummaryToMemory({
        content: summaryMarkdown,
        title: text(normalizedSummaryJson.title) ?? source.title ?? "Meeting summary",
        tldr: text(normalizedSummaryJson.tldr),
        source: "recording-transcript-workflow",
        sourceId: source.sessionId,
        sourceSystem: source.kind,
        timestamp: source.endedAt ?? new Date().toISOString(),
        author: "Prism Recording Workflow",
        metadata: {
          request_id: request.id,
          discord: source.discord,
          action_items: Array.isArray(normalizedSummaryJson.actionItems) ? normalizedSummaryJson.actionItems : [],
          tags: Array.isArray(normalizedSummaryJson.tags) ? normalizedSummaryJson.tags : [],
        },
      });
      memoryResult = {
        ok: promoted.ok,
        reused: false,
        memoryPath: promoted.memoryPath,
        memoryArtifactUrl: promoted.artifactUrl,
        skippedReason: promoted.skippedReason,
        rawTranscriptIngestSkipped: true,
      };
    } catch (error) {
      memoryResult = {
        ok: false,
        reused: false,
        memoryPath: null,
        memoryArtifactUrl: null,
        error: error instanceof Error ? error.message : "Memory promotion failed",
        rawTranscriptIngestSkipped: true,
      };
    }
  }

  const downstreamPlan = {
    version: 1,
    recommended: Boolean(config.downstreamWorkflowKey),
    downstreamWorkflowKey: config.downstreamWorkflowKey,
    autoStartDownstream: config.autoStartDownstream,
    source,
    summary: {
      memoryPath: memoryResult.memoryPath ?? null,
      memoryArtifactUrl: memoryResult.memoryArtifactUrl ?? null,
    },
    transcript: transcriptReference,
    artifactsToShare: ["meeting-summary.md", "meeting-summary.json", "memory-ingest-result.json"],
    privateArtifacts: ["transcript-reference.json"],
    rawTranscriptSharingAllowed: transcriptReference.sharingAllowed,
  };
  const prepared = [
    markdownArtifact("meeting-summary", "meeting-summary.md", "Deterministically prepared meeting summary.", summaryMarkdown),
    jsonArtifact("meeting-summary-json", "meeting-summary.json", "Structured meeting summary from the recording source.", normalizedSummaryJson),
    jsonArtifact("transcript-reference", "transcript-reference.json", "Private transcript provenance and sharing policy.", transcriptReference),
    jsonArtifact("memory-ingest-result", "memory-ingest-result.json", "Prism Memory promotion or reuse result.", memoryResult),
    jsonArtifact("downstream-publish-plan", "downstream-publish-plan.json", "Generic downstream publishing handoff plan.", downstreamPlan),
  ];
  for (const artifact of prepared) {
    await saveArtifact(request.id, artifact, { hookKey: hook.key });
  }

  let childRequest: ChangeRequestRecord | null = null;
  let childCreated = false;
  let autoStart: { started: boolean; reason?: string; status?: number; response?: unknown; error?: string } | null = null;
  let handoffError: string | null = null;
  if (config.downstreamWorkflowKey) {
    const downstreamWorkflow = getWorkflowByKey(config.downstreamWorkflowKey);
    if (config.downstreamWorkflowKey === request.workflowKey) {
      handoffError = "DOWNSTREAM_WORKFLOW_RECURSION";
    } else if (!downstreamWorkflow) {
      handoffError = "DOWNSTREAM_WORKFLOW_NOT_FOUND";
    } else if (!downstreamWorkflow.enabled) {
      handoffError = "DOWNSTREAM_WORKFLOW_DISABLED";
    } else {
      const childSource = handoffSource(hook, payload, config.downstreamWorkflowKey, request.id);
      childRequest = listChangeRequests({ source: childSource, limit: 1 })[0] ?? null;
      if (!childRequest) {
        childRequest = createChangeRequest({
          title: source.title ? `Post-recording publish: ${source.title}` : `Post-recording publish for request #${request.requestNumber}`,
          description: `Continue instance-specific post-recording work prepared by request #${request.requestNumber}. Use the copied deterministic artifacts and recording handoff metadata.`,
          workflowKey: config.downstreamWorkflowKey,
          requestType: request.requestType,
          priority: request.priority,
          source: childSource,
          targetAppId: request.targetAppId,
          targetEnvironmentId: request.targetEnvironmentId,
          acceptanceCriteria: [],
          constraints: {
            recordingHandoff: {
              parentRequestId: request.id,
              parentRequestNumber: request.requestNumber,
              hookKey: hook.key,
              sourceId: source.sessionId,
              sourceKind: source.kind,
            },
          },
          attachments: [],
          agentRecommendation: "Use the deterministic meeting artifacts as source evidence. Reconcile external systems before creating or sending anything.",
        });
        if (!childRequest) throw new Error("DOWNSTREAM_REQUEST_CREATE_FAILED");
        childCreated = true;
        for (const artifact of prepared) {
          await saveArtifact(childRequest.id, artifact, {
            copiedFromRequestId: request.id,
            copiedFromRequestNumber: request.requestNumber,
          });
        }
      }
      const handoff = {
        parentRequestId: request.id,
        parentRequestNumber: request.requestNumber,
        childRequestId: childRequest.id,
        childRequestNumber: childRequest.requestNumber,
        downstreamWorkflowKey: config.downstreamWorkflowKey,
        sourceId: source.sessionId,
      };
      await saveArtifact(request.id, jsonArtifact("workflow-handoff", "workflow-handoff.json", "Parent-to-child recording workflow handoff.", handoff));
      if (childCreated) {
        await saveArtifact(childRequest.id, jsonArtifact("workflow-handoff", "workflow-handoff.json", "Parent-to-child recording workflow handoff.", handoff));
      } else {
        await saveArtifact(childRequest.id, jsonArtifact(
          "workflow-handoff-attempt",
          `workflow-handoff-attempt-${request.requestNumber}.json`,
          "A later parent request reused this idempotent recording workflow handoff.",
          handoff,
        ));
      }
      if (config.autoStartDownstream && childCreated) {
        const { autoStartWorkflowRequest } = await import("@/lib/workflow-autostart");
        autoStart = await autoStartWorkflowRequest(childRequest, { baseUrl: input.baseUrl });
      }
    }
  }

  if (handoffError) {
    await saveArtifact(request.id, jsonArtifact("workflow-handoff-error", "workflow-handoff-error.json", "The configured downstream workflow could not be started.", {
      error: handoffError,
      downstreamWorkflowKey: config.downstreamWorkflowKey,
    }));
  }
  updateChangeRequest(request.id, {
    workflowStepKey: "closed",
    resolutionSummary: childRequest
      ? `Prepared recording artifacts deterministically and handed off to request #${childRequest.requestNumber}.`
      : handoffError
        ? `Prepared recording artifacts deterministically; downstream handoff failed: ${handoffError}.`
        : "Prepared recording artifacts deterministically; no downstream workflow was configured.",
  });
  return { status: handoffError ? "handoff_failed" as const : "completed" as const, childRequest, autoStart };
}
