import assert from "node:assert/strict"
import test from "node:test"

import {
  hasTaskRunnerMutationAccess,
  resolveTaskRunnerMutationToken,
} from "./task-runner-ledger-auth"

test("task-runner ledger auth prefers its dedicated control token", () => {
  assert.equal(resolveTaskRunnerMutationToken({
    TASK_RUNNER_TOKEN: " runner-token ",
    INTERNAL_SERVICE_TOKEN: "service-token",
  }), "runner-token")
  assert.equal(resolveTaskRunnerMutationToken({
    INTERNAL_SERVICE_TOKEN: " service-token ",
  }), "service-token")
})

test("task-runner ledger mutations fail closed", () => {
  assert.equal(hasTaskRunnerMutationAccess("runner-token", "runner-token"), true)
  assert.equal(hasTaskRunnerMutationAccess("service-token", "runner-token"), false)
  assert.equal(hasTaskRunnerMutationAccess(null, "runner-token"), false)
  assert.equal(hasTaskRunnerMutationAccess(null, ""), false)
})
