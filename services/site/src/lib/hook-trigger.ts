import {
  buildRequestArtifactStoragePath,
  createChangeRequest,
  createHookRun,
  createRequestArtifact,
  createWorkflowEvent,
  getDefaultTargetEnvironmentForApp,
  getHookByKey,
  getTargetApp,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  markHookTriggered,
  updateHookRun,
  writeRequestArtifactFile,
  type HookRecord,
} from "@/lib/app-core"
import { randomUUID } from "node:crypto"
import { parseEstimatedHumanHours } from "@/lib/request-estimates"
import { autoStartWorkflowRequest } from "@/lib/workflow-autostart"
import { isBuiltInRecordingHook, processBuiltInRecordingHook } from "@/lib/recording-hook-processing"

type HookTriggerResult = {
  hook: HookRecord
  changeRequest: NonNullable<ReturnType<typeof createChangeRequest>>
  autoStart: Awaited<ReturnType<typeof autoStartWorkflowRequest>> | null
  autoStartQueued?: boolean
  recordingProcessing?: Awaited<ReturnType<typeof processBuiltInRecordingHook>> | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function boolValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback
}

function templateValue(payload: Record<string, unknown>, key: string) {
  if (key === "payload") {
    return JSON.stringify(payload)
  }
  if (key === "date") {
    return new Date().toISOString().slice(0, 10)
  }
  if (key === "now") {
    return new Date().toISOString()
  }
  const value = payload[key]
  if (value === undefined || value === null) {
    return ""
  }
  return typeof value === "string" ? value : JSON.stringify(value)
}

function renderTemplate(template: unknown, payload: Record<string, unknown>, fallback = "") {
  const raw = stringValue(template, fallback)
  return raw.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => templateValue(payload, key))
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
}

async function writeHookPayloadArtifact(hook: HookRecord, requestId: string, payload: Record<string, unknown>) {
  const artifactId = randomUUID()
  const name = "hook-payload.json"
  const content = Buffer.from(JSON.stringify({
    hook: {
      key: hook.key,
      name: hook.name,
      workflowKey: hook.workflowKey,
    },
    payload,
    receivedAt: new Date().toISOString(),
  }, null, 2), "utf8")
  const storagePath = buildRequestArtifactStoragePath({ requestId, artifactId, name })

  await writeRequestArtifactFile(storagePath, content)
  const workflowRun = getWorkflowRunForRequest(requestId)
  const artifact = createRequestArtifact({
    id: artifactId,
    requestId,
    workflowRunId: workflowRun?.id ?? null,
    kind: "hook-payload",
    name,
    description: `Payload received by hook ${hook.key}.`,
    mimeType: "application/json",
    storagePath,
    sizeBytes: content.byteLength,
    metadata: {
      hookKey: hook.key,
      source: `hook:${hook.key}`,
    },
    createdBy: "hook",
  })

  if (workflowRun) {
    createWorkflowEvent({
      workflowRunId: workflowRun.id,
      requestId,
      stepKey: workflowRun.currentStepKey,
      eventType: "artifact.created",
      actorType: "hook",
      payload: {
        artifactId: artifact.id,
        kind: artifact.kind,
        name: artifact.name,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
      },
    })
  }

  return artifact
}

export async function triggerHook(
  hookKey: string,
  payload: Record<string, unknown>,
  options: { baseUrl?: string | null; source?: string; waitForAutoStart?: boolean } = {},
): Promise<HookTriggerResult> {
  const source = options.source ?? `hook:${hookKey}`
  let hookRunId: string | null = null
  const hook = getHookByKey(hookKey)
  if (!hook) {
    const run = createHookRun({
      hookKey,
      source,
      payload,
    })
    updateHookRun(run.id, {
      status: "failed",
      errorMessage: "HOOK_NOT_FOUND",
      result: { error: "HOOK_NOT_FOUND" },
      finishedAt: new Date().toISOString(),
    })
    throw new Error("HOOK_NOT_FOUND")
  }
  const hookRun = createHookRun({
    hookId: hook.id,
    hookKey: hook.key,
    hookName: hook.name,
    workflowKey: hook.workflowKey,
    source,
    payload,
  })
  hookRunId = hookRun.id
  if (!hook.enabled) {
    updateHookRun(hookRunId, {
      status: "failed",
      errorMessage: "HOOK_DISABLED",
      result: { error: "HOOK_DISABLED" },
      finishedAt: new Date().toISOString(),
    })
    throw new Error("HOOK_DISABLED")
  }

  const workflow = getWorkflowByKey(hook.workflowKey)
  if (!workflow) {
    updateHookRun(hookRunId, {
      status: "failed",
      errorMessage: "WORKFLOW_NOT_FOUND",
      result: { error: "WORKFLOW_NOT_FOUND" },
      finishedAt: new Date().toISOString(),
    })
    throw new Error("WORKFLOW_NOT_FOUND")
  }
  if (!workflow.enabled) {
    updateHookRun(hookRunId, {
      status: "failed",
      errorMessage: "WORKFLOW_DISABLED",
      result: { error: "WORKFLOW_DISABLED" },
      finishedAt: new Date().toISOString(),
    })
    throw new Error("WORKFLOW_DISABLED")
  }

  const requestTemplate = hook.requestTemplate
  const targetAppId = stringValue(requestTemplate.targetAppId ?? payload.targetAppId)
  const targetApp = targetAppId ? getTargetApp(targetAppId) : null
  if (targetAppId && (!targetApp || !targetApp.agentEnabled)) {
    updateHookRun(hookRunId, {
      status: "failed",
      errorMessage: "TARGET_APP_INACTIVE",
      result: { error: "TARGET_APP_INACTIVE", targetAppId },
      finishedAt: new Date().toISOString(),
    })
    throw new Error("TARGET_APP_INACTIVE")
  }
  const targetEnvironmentId =
    stringValue(requestTemplate.targetEnvironmentId ?? payload.targetEnvironmentId) ||
    (targetAppId ? getDefaultTargetEnvironmentForApp(targetAppId)?.id ?? "" : "")
  const constraints = isRecord(requestTemplate.constraints) ? requestTemplate.constraints : {}
  const payloadConstraints = isRecord(payload.constraints) ? payload.constraints : {}
  const attachments = Array.isArray(requestTemplate.attachments) ? requestTemplate.attachments : []
  const hasEstimatedHumanHours =
    requestTemplate.estimatedHumanHours !== undefined ||
    requestTemplate.estimated_human_hours !== undefined ||
    payload.estimatedHumanHours !== undefined ||
    payload.estimated_human_hours !== undefined
  const estimatedHumanHours = parseEstimatedHumanHours(
    requestTemplate.estimatedHumanHours ?? requestTemplate.estimated_human_hours ?? payload.estimatedHumanHours ?? payload.estimated_human_hours,
  )
  if (hasEstimatedHumanHours && estimatedHumanHours === undefined) {
    updateHookRun(hookRunId, {
      status: "failed",
      errorMessage: "INVALID_ESTIMATED_HUMAN_HOURS",
      result: { error: "INVALID_ESTIMATED_HUMAN_HOURS" },
      finishedAt: new Date().toISOString(),
    })
    throw new Error("INVALID_ESTIMATED_HUMAN_HOURS")
  }

  const changeRequest = createChangeRequest({
    title: renderTemplate(requestTemplate.titleTemplate ?? requestTemplate.title, payload, `${hook.name} - {{date}}`),
    description: renderTemplate(
      requestTemplate.descriptionTemplate ?? requestTemplate.description,
      payload,
      `Triggered by hook ${hook.key}.\n\nPayload:\n{{payload}}`,
    ),
    workflowKey: hook.workflowKey,
    requestType: stringValue(requestTemplate.requestType ?? payload.requestType, "content"),
    priority: stringValue(requestTemplate.priority ?? payload.priority, "normal"),
    source,
    requestedByUserId: null,
    targetAppId: targetAppId || null,
    targetEnvironmentId: targetEnvironmentId || null,
    triageSummary: null,
    estimatedHumanHours: estimatedHumanHours ?? null,
    acceptanceCriteria: Array.isArray(requestTemplate.acceptanceCriteria) ? requestTemplate.acceptanceCriteria : [],
    constraints: {
      ...constraints,
      ...payloadConstraints,
      hook: {
        key: hook.key,
        payload,
      },
    },
    attachments,
    agentRecommendation: stringValue(requestTemplate.agentRecommendation),
  })

  if (!changeRequest) {
    updateHookRun(hookRunId, {
      status: "failed",
      errorMessage: "HOOK_REQUEST_CREATE_FAILED",
      result: { error: "HOOK_REQUEST_CREATE_FAILED" },
      finishedAt: new Date().toISOString(),
    })
    throw new Error("HOOK_REQUEST_CREATE_FAILED")
  }

  let autoStart: Awaited<ReturnType<typeof autoStartWorkflowRequest>> | null = null
  const autoRunEnabled = boolValue(hook.autoRun.enabled, false)
  const requestedSkills = stringArray(hook.autoRun.requestedSkills)
  try {
    await writeHookPayloadArtifact(hook, changeRequest.id, payload)
  } catch (error) {
    console.warn(JSON.stringify({
      event: "hook.payload_artifact_failed",
      hookKey: hook.key,
      requestId: changeRequest.id,
      error: error instanceof Error ? error.message : "Unknown payload artifact error",
    }))
  }

  let recordingProcessing: Awaited<ReturnType<typeof processBuiltInRecordingHook>> | null = null
  if (isBuiltInRecordingHook(hook)) {
    try {
      recordingProcessing = await processBuiltInRecordingHook({
        hook,
        request: changeRequest,
        payload,
        baseUrl: options.baseUrl,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "RECORDING_HOOK_PROCESSING_FAILED"
      updateHookRun(hookRunId, {
        status: "failed",
        requestId: changeRequest.id,
        requestNumber: changeRequest.requestNumber,
        requestTitle: changeRequest.title,
        errorMessage: message,
        result: { error: message },
        finishedAt: new Date().toISOString(),
      })
      throw error
    }
  }

  const runAutoStart = async () => {
    try {
      return await autoStartWorkflowRequest(changeRequest, { baseUrl: options.baseUrl, requestedSkills })
    } catch (error) {
      console.warn(JSON.stringify({
        event: "hook.autostart_failed",
        hookKey: hook.key,
        requestId: changeRequest.id,
        error: error instanceof Error ? error.message : "Unknown workflow autostart error",
      }))
      return null
    }
  }

  let autoStartQueued = false
  if (autoRunEnabled && !recordingProcessing && options.waitForAutoStart !== false) {
    autoStart = await runAutoStart()
  } else if (autoRunEnabled && !recordingProcessing) {
    autoStartQueued = true
    setTimeout(() => {
      void runAutoStart()
    }, 0)
  }
  markHookTriggered(hook.key)
  updateHookRun(hookRunId, {
    status: "succeeded",
    requestId: changeRequest.id,
    requestNumber: changeRequest.requestNumber,
    requestTitle: changeRequest.title,
    autoStartQueued,
    autoStartStarted: Boolean(autoStart?.started),
    result: {
      requestId: changeRequest.id,
      requestNumber: changeRequest.requestNumber,
      autoStartQueued,
      autoStartStarted: Boolean(autoStart?.started),
      autoStartReason: autoStart?.reason ?? null,
      recordingProcessingStatus: recordingProcessing?.status ?? null,
      downstreamRequestId: recordingProcessing?.childRequest?.id ?? null,
      downstreamRequestNumber: recordingProcessing?.childRequest?.requestNumber ?? null,
    },
    finishedAt: new Date().toISOString(),
  })

  return {
    hook: getHookByKey(hook.key) ?? hook,
    changeRequest,
    autoStart,
    autoStartQueued,
    recordingProcessing,
  }
}
