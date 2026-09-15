export type TaskRunnerTriggerResult = {
  status: number
  payload: Record<string, unknown>
}

type FetchLike = typeof fetch

export async function triggerTaskRunnerTask(input: {
  baseUrl: string
  token?: string | null
  taskKey: string
  fetchImpl?: FetchLike
}): Promise<TaskRunnerTriggerResult> {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "")
  if (!baseUrl) {
    throw new Error("TASK_RUNNER_BASE_URL_MISSING")
  }

  const taskKey = input.taskKey.trim()
  if (!taskKey) {
    throw new Error("TASK_KEY_REQUIRED")
  }

  const response = await (input.fetchImpl ?? fetch)(
    `${baseUrl}/tasks/${encodeURIComponent(taskKey)}/run`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.token?.trim() ? { "x-task-runner-token": input.token.trim() } : {}),
      },
      body: JSON.stringify({ source: "agent" }),
    },
  )
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>

  return { status: response.status, payload }
}
