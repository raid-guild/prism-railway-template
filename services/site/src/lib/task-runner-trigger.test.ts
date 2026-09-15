import assert from "node:assert/strict"
import test from "node:test"

import { triggerTaskRunnerTask } from "./task-runner-trigger"

test("agent task triggers dispatch through task-runner", async () => {
  let requestUrl = ""
  let requestInit: RequestInit | undefined

  const result = await triggerTaskRunnerTask({
    baseUrl: "http://task-runner.internal/",
    token: "runner-token",
    taskKey: "veydrift bounded/autopilot",
    fetchImpl: (async (url, init) => {
      requestUrl = String(url)
      requestInit = init
      return new Response(JSON.stringify({ ok: true, accepted: true }), {
        status: 202,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch,
  })

  assert.equal(requestUrl, "http://task-runner.internal/tasks/veydrift%20bounded%2Fautopilot/run")
  assert.equal(requestInit?.method, "POST")
  assert.equal((requestInit?.headers as Record<string, string>)["x-task-runner-token"], "runner-token")
  assert.equal(requestInit?.body, JSON.stringify({ source: "agent" }))
  assert.deepEqual(result, {
    status: 202,
    payload: { ok: true, accepted: true },
  })
})

test("agent task triggers reject missing runner configuration", async () => {
  await assert.rejects(
    triggerTaskRunnerTask({ baseUrl: "", taskKey: "veydrift-bounded-autopilot-30m" }),
    /TASK_RUNNER_BASE_URL_MISSING/,
  )
})
