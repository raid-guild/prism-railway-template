type TaskRunnerTokenEnvironment = Record<string, string | undefined>

export function resolveTaskRunnerMutationToken(env: TaskRunnerTokenEnvironment) {
  return (
    env.TASK_RUNNER_TOKEN
    ?? env.INTERNAL_SERVICE_TOKEN
    ?? env.SERVICE_SHARED_TOKEN
    ?? ""
  ).trim()
}

export function hasTaskRunnerMutationAccess(actual: string | null, expected: string) {
  return Boolean(expected) && actual === expected
}
