import { NextResponse } from "next/server"

import {
  assignAgentProfileToSession,
  agentExecutionModes,
  createAgentRun,
  createAgentResponseJob,
  createAgentSession,
  getAgentProfile,
  getAgentRun,
  getAgentResponseJob,
  getAgentSession,
  getAgentSessionProfileAssignment,
  updateAgentRun,
  updateAgentResponseJob,
} from "@/lib/app-core"
import { requireLocalAdminAccess } from "@/lib/local-admin-api"
import { handleResponsePost } from "@/lib/response-route-handler"
import { consoleExecutionModeForAgentProfile } from "@/lib/agent-profile-runtime-scope"

type ResponseInputMessage = {
  role?: unknown
  content?: unknown
}

function parseInputMessages(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((entry): entry is ResponseInputMessage => !!entry && typeof entry === "object")
    .map((entry) => ({
      role: typeof entry.role === "string" ? entry.role : "user",
      content: typeof entry.content === "string" ? entry.content.trim() : "",
    }))
    .filter((entry) => entry.content)
}

function traceFromPayload(payload: Record<string, unknown>) {
  const metadata = payload.metadata
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const trace = (metadata as Record<string, unknown>).trace
    if (Array.isArray(trace)) {
      return trace.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    }
  }
  return []
}

function parseString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

async function runConsoleJob(jobId: string, agentRunId: string, requestUrl: string) {
  const job = createJobSnapshot(jobId)
  if (!job) return

  const startedAt = new Date().toISOString()
  updateAgentRun(agentRunId, {
    status: "running",
    startedAt,
  })
  updateAgentResponseJob(jobId, {
    status: "running",
    startedAt,
  })

  try {
    const response = await handleResponsePost(
      new Request(new URL("/admin/responses", requestUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...job.input,
          agent_run_id: agentRunId,
          response_job_id: jobId,
        }),
      }),
      async () => ({ ok: true as const }),
    )
    const text = await response.text()
    const parsedPayload = text ? JSON.parse(text) : {}
    const payload =
      parsedPayload && typeof parsedPayload === "object" && !Array.isArray(parsedPayload)
        ? parsedPayload as Record<string, unknown>
        : { output_text: String(parsedPayload ?? "") }
    const outputText = typeof payload.output_text === "string" ? payload.output_text : null
    const sessionId = typeof payload.session_id === "string" ? payload.session_id : job.sessionId
    const trace = traceFromPayload(payload)

    // A console cancellation is terminal even when the runtime races back with
    // a late response. The cancel route owns the response-job terminal state.
    if (getAgentRun(agentRunId)?.status === "canceled") {
      return
    }

    updateAgentResponseJob(jobId, {
      sessionId,
      status: response.ok ? "succeeded" : "failed",
      response: payload,
      outputText,
      errorMessage: response.ok ? null : typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`,
      trace,
      finishedAt: new Date().toISOString(),
    })
    updateAgentRun(agentRunId, {
      sessionId,
      status: response.ok ? "succeeded" : "failed",
      result: payload,
      trace,
      errorMessage: response.ok ? null : typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`,
      finishedAt: new Date().toISOString(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "CONSOLE_JOB_FAILED"
    updateAgentResponseJob(jobId, {
      status: "failed",
      errorMessage,
      finishedAt: new Date().toISOString(),
    })
    updateAgentRun(agentRunId, {
      status: "failed",
      errorMessage,
      finishedAt: new Date().toISOString(),
    })
  }
}

function createJobSnapshot(jobId: string) {
  return getAgentResponseJob(jobId)
}

export async function POST(request: Request) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  let payload: unknown = null
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
  const rawExecutionMode = parseString(body.execution_mode ?? body.executionMode) || "worker"
  if (!agentExecutionModes.includes(rawExecutionMode as (typeof agentExecutionModes)[number])) {
    return NextResponse.json({ ok: false, error: "Invalid Agent execution mode" }, { status: 400 })
  }
  const requestedAgentProfileKey = parseString(body.agent_profile_key ?? body.agentProfileKey)
  const requestedAgentProfile = requestedAgentProfileKey ? getAgentProfile(requestedAgentProfileKey) : null
  if (requestedAgentProfileKey && (!requestedAgentProfile || requestedAgentProfile.status !== "active")) {
    return NextResponse.json({ ok: false, error: "Agent Profile is unavailable" }, { status: 400 })
  }
  const requestedExecutionMode = consoleExecutionModeForAgentProfile(requestedAgentProfile, rawExecutionMode)
  const inputMessages = parseInputMessages(body.input)
  const latestUserMessage = [...inputMessages].reverse().find((entry) => entry.role === "user") ?? null
  if (!latestUserMessage) {
    return NextResponse.json(
      { ok: false, error: "input must include at least one user message" },
      { status: 400 },
    )
  }

  const requestedSessionId =
    typeof (body.session_id ?? body.sessionId) === "string"
      ? String(body.session_id ?? body.sessionId).trim()
      : ""
  let session = requestedSessionId ? getAgentSession(requestedSessionId) : null
  if (requestedSessionId && (!session || session.source !== "admin-console")) {
    return NextResponse.json({ ok: false, error: "Agent session not found" }, { status: 404 })
  }
  if (session && requestedAgentProfile) {
    const assignment = getAgentSessionProfileAssignment(session.id)
    if (assignment?.profileId && assignment.profileId !== requestedAgentProfile.id) {
      return NextResponse.json({ ok: false, error: "Console session belongs to another Agent Profile" }, { status: 409 })
    }
  }
  if (!session) {
    session = createAgentSession({
      source: "admin-console",
      status: "active",
      title: latestUserMessage.content.slice(0, 80),
      linkedChangeRequestId:
        typeof body.linked_change_request_id === "string"
          ? body.linked_change_request_id
          : typeof body.linkedChangeRequestId === "string"
            ? body.linkedChangeRequestId
            : null,
      linkedTargetEnvironmentId:
        typeof body.linked_target_environment_id === "string"
          ? body.linked_target_environment_id
          : typeof body.linkedTargetEnvironmentId === "string"
            ? body.linkedTargetEnvironmentId
            : null,
      createdByUserId: access.userId,
      meta: {
        transport: "site",
        ...(requestedAgentProfile ? { agentProfileKey: requestedAgentProfile.key, agentProfileVersion: requestedAgentProfile.version } : {}),
      },
      lastMessageAt: new Date().toISOString(),
    })
  }
  if (!session) {
    return NextResponse.json({ ok: false, error: "AGENT_SESSION_CREATE_FAILED" }, { status: 500 })
  }
  if (requestedAgentProfile) {
    try {
      assignAgentProfileToSession({ sessionId: session.id, profileId: requestedAgentProfile.id, conversationScope: "individual" })
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "AGENT_SESSION_PROFILE_ASSIGNMENT_FAILED" }, { status: 409 })
    }
  }

  const input = {
    ...body,
    session_id: session.id,
    execution_mode: requestedExecutionMode,
  }
  const linkedChangeRequestId = parseString(body.linked_change_request_id ?? body.linkedChangeRequestId)
  const linkedTargetEnvironmentId = parseString(body.linked_target_environment_id ?? body.linkedTargetEnvironmentId)
  const agentRun = createAgentRun({
    kind: linkedChangeRequestId ? "workflow_step" : "console",
    status: "queued",
    requestId: linkedChangeRequestId,
    sessionId: session.id,
    source: "admin-console",
    input,
  })
  if (!agentRun) {
    return NextResponse.json({ ok: false, error: "AGENT_RUN_CREATE_FAILED" }, { status: 500 })
  }
  const job = createAgentResponseJob({
    sessionId: session.id,
    input: {
      ...input,
      agent_run_id: agentRun.id,
    },
  })
  if (!job) {
    updateAgentRun(agentRun.id, {
      status: "failed",
      errorMessage: "CONSOLE_JOB_CREATE_FAILED",
      finishedAt: new Date().toISOString(),
    })
    return NextResponse.json({ ok: false, error: "CONSOLE_JOB_CREATE_FAILED" }, { status: 500 })
  }

  updateAgentRun(agentRun.id, {
    result: {
      responseJobId: job.id,
      linkedTargetEnvironmentId,
    },
  })

  void runConsoleJob(job.id, agentRun.id, request.url)

  return NextResponse.json(
    {
      ok: true,
      job: {
        ...job,
        id: agentRun.id,
        status: agentRun.status,
        trace: agentRun.trace,
      },
      agentRun,
      jobId: agentRun.id,
      session_id: session.id,
    },
    { status: 202 },
  )
}
