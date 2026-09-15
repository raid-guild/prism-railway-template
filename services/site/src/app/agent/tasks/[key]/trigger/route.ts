import { NextResponse } from "next/server"

import { requireServiceAccess } from "@/lib/internal-service"
import { triggerTaskRunnerTask } from "@/lib/task-runner-trigger"

function taskRunnerBaseUrl() {
  return (process.env.TASK_RUNNER_BASE_URL ?? "").trim().replace(/\/+$/, "")
}

function taskRunnerToken() {
  return (process.env.TASK_RUNNER_TOKEN ?? process.env.INTERNAL_SERVICE_TOKEN ?? "").trim()
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const baseUrl = taskRunnerBaseUrl()
  if (!baseUrl) {
    return NextResponse.json(
      { ok: false, error: "TASK_RUNNER_BASE_URL is not configured on the site service" },
      { status: 503 },
    )
  }

  const { key } = await params
  try {
    const result = await triggerTaskRunnerTask({
      baseUrl,
      token: taskRunnerToken(),
      taskKey: key,
    })
    return NextResponse.json(result.payload, { status: result.status })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task runner request failed"
    return NextResponse.json(
      { ok: false, error: "TASK_RUNNER_UNAVAILABLE", message },
      { status: 502 },
    )
  }
}
