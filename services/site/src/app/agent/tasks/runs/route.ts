import { NextResponse } from "next/server"
import { createTaskRun, listTaskRuns } from "@/lib/app-core"
import {
  parseString,
  readOptionalInteger,
  requireServiceAccess,
  requireTaskRunnerMutationAccess,
} from "@/lib/internal-service"

function parseConfig(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function parseArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

export async function GET(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const url = new URL(request.url)
  const limit = readOptionalInteger(url.searchParams.get("limit")) ?? 50
  const taskKey = parseString(url.searchParams.get("taskKey") ?? url.searchParams.get("task_key"))

  return NextResponse.json({ ok: true, runs: listTaskRuns({ taskKey, limit }) })
}

export async function POST(request: Request) {
  const access = await requireTaskRunnerMutationAccess()
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
  const taskKey = parseString(body.taskKey ?? body.task_key)
  if (!taskKey) {
    return NextResponse.json({ ok: false, error: "taskKey is required" }, { status: 400 })
  }

  try {
    const run = createTaskRun({
      taskKey,
      status: parseString(body.status) || "running",
      triggerSource: parseString(body.triggerSource ?? body.trigger_source) || "manual",
      startedAt: parseString(body.startedAt ?? body.started_at) || null,
      resultSummary: parseString(body.resultSummary ?? body.result_summary) || null,
      errorMessage: parseString(body.errorMessage ?? body.error_message) || null,
      inputSnapshot: parseConfig(body.inputSnapshot ?? body.input_snapshot),
      outputSnapshot: parseConfig(body.outputSnapshot ?? body.output_snapshot),
      artifactRefs: parseArray(body.artifactRefs ?? body.artifact_refs),
    })
    return NextResponse.json({ ok: true, run }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.startsWith("TASK_NOT_FOUND") ? 404 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
