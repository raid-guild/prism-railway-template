import { NextResponse } from "next/server"
import { getTaskRun, updateTaskRun } from "@/lib/app-core"
import {
  parseNullableString,
  parseString,
  requireServiceAccess,
  requireTaskRunnerMutationAccess,
} from "@/lib/internal-service"

function parseConfig(value: unknown, fallback: Record<string, unknown> | undefined) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return fallback
}

function parseArray(value: unknown, fallback: unknown[] | undefined) {
  return Array.isArray(value) ? value : fallback
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await context.params
  const run = getTaskRun(id)
  if (!run) {
    return NextResponse.json({ ok: false, error: "Task run not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, run })
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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
  const { id } = await context.params

  try {
    const run = updateTaskRun(id, {
      status: parseString(body.status) || undefined,
      finishedAt: parseNullableString(body.finishedAt ?? body.finished_at),
      resultSummary: parseNullableString(body.resultSummary ?? body.result_summary),
      errorMessage: parseNullableString(body.errorMessage ?? body.error_message),
      inputSnapshot: parseConfig(body.inputSnapshot ?? body.input_snapshot, undefined),
      outputSnapshot: parseConfig(body.outputSnapshot ?? body.output_snapshot, undefined),
      artifactRefs: parseArray(body.artifactRefs ?? body.artifact_refs, undefined),
    })
    return NextResponse.json({ ok: true, run })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message === "TASK_RUN_NOT_FOUND" ? 404 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
