import { NextResponse } from "next/server"
import { assignAccountabilityDomain, deleteCustomTaskByKey, getAccountabilityAssignment, getAgentProfileVersion, getTaskByKey, getTaskScriptByKey, listTasks, taskAgentExecutor, taskUsesAgentExecutor, upsertTask } from "@/lib/app-core"
import { parseNullableString, parseString, requireServiceAccess } from "@/lib/internal-service"
import { modelTierFromAgentConfig } from "@/lib/model-tier"
import { validateScriptTaskHandoff } from "@/lib/script-task-handoff-input"

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") return new Set(["1", "true", "yes", "on"]).has(value.trim().toLowerCase())
  return fallback
}

function parseBooleanFlag(value: unknown) {
  return parseBoolean(value, false)
}

function parseConfig(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function taskExecutionPolicy(task: { taskType: string; agentConfig: Record<string, unknown> }) {
  if (!taskUsesAgentExecutor(task.taskType, task.agentConfig)) return null
  try {
    const executor = taskAgentExecutor(task.agentConfig)
    const profile = getAgentProfileVersion(executor.profileId, executor.profileVersion)
    return {
      executorProfileKey: executor.profileKey,
      executorProfileVersion: executor.profileVersion,
      resolution: executor.resolution,
      runtimeProfileKey: profile?.runtimeProfileKey ?? null,
      modelTier: profile?.modelTier ?? null,
    }
  } catch {
    return null
  }
}

export async function GET() {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json({
    ok: true,
    tasks: listTasks().map((task) => ({
      ...task,
      executionPolicy: taskExecutionPolicy(task),
      accountabilityDomain: getAccountabilityAssignment("task", task.id),
    })),
  })
}

export async function POST(request: Request) {
  const access = await requireServiceAccess()
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
  const key = parseString(body.key)
  const name = parseString(body.name)
  if (!key || !name) {
    return NextResponse.json({ ok: false, error: "key and name are required" }, { status: 400 })
  }

  if (parseBooleanFlag(body.preserveExisting ?? body.preserve_existing)) {
    const existing = getTaskByKey(key)
    if (existing) {
      return NextResponse.json({ ok: true, task: existing, preserved: true })
    }
  }

  const enabled = parseBoolean(body.enabled)
  const taskType = parseString(body.taskType ?? body.task_type) || "builtin"
  const inputConfig = parseConfig(body.inputConfig ?? body.input_config)
  const instructionConfig = parseConfig(body.instructionConfig ?? body.instruction_config)
  const agentConfig = parseConfig(body.agentConfig ?? body.agent_config)
  try {
    modelTierFromAgentConfig(agentConfig)
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "MODEL_TIER_INVALID" }, { status: 400 })
  }
  let normalizedInputConfig = inputConfig
  if (taskType === "script-runner") {
    const scriptKey = parseString(inputConfig.scriptKey ?? inputConfig.script_key)
    if (!scriptKey) {
      return NextResponse.json({ ok: false, error: "script-runner tasks require inputConfig.scriptKey" }, { status: 400 })
    }
    const script = getTaskScriptByKey(scriptKey)
    if (!script) {
      return NextResponse.json({ ok: false, error: `Task script not found: ${scriptKey}` }, { status: 400 })
    }
    if (enabled && !script.enabled) {
      return NextResponse.json({ ok: false, error: `Task script is disabled: ${scriptKey}` }, { status: 400 })
    }
    const handoffError = validateScriptTaskHandoff(instructionConfig, agentConfig)
    if (handoffError) {
      return NextResponse.json({ ok: false, error: handoffError }, { status: 400 })
    }
    normalizedInputConfig = { ...inputConfig, scriptKey }
  }
  if (taskType === "http-post") {
    const url = parseString(inputConfig.url)
    const method = (parseString(inputConfig.method) || "POST").toUpperCase()
    if (!url) {
      return NextResponse.json({ ok: false, error: "http-post tasks require inputConfig.url" }, { status: 400 })
    }
    if (method !== "POST") {
      return NextResponse.json({ ok: false, error: "http-post tasks currently support method POST only" }, { status: 400 })
    }
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "https:") {
        return NextResponse.json({ ok: false, error: "http-post tasks require an https URL" }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ ok: false, error: "http-post tasks require a valid inputConfig.url" }, { status: 400 })
    }
    normalizedInputConfig = { ...inputConfig, method, url }
  }

  const task = upsertTask({
    key,
    name,
    description: parseNullableString(body.description) ?? null,
    enabled,
    triggerType: parseString(body.triggerType ?? body.trigger_type) || "schedule",
    scheduleCron: parseNullableString(body.scheduleCron ?? body.schedule_cron) ?? null,
    timezone: parseString(body.timezone) || "UTC",
    taskType,
    inputConfig: normalizedInputConfig,
    instructionConfig,
    outputConfig: parseConfig(body.outputConfig ?? body.output_config),
    agentConfig,
  })

  const accountabilityDomainKey = parseString(body.accountabilityDomainKey ?? body.accountability_domain_key)
  const accountabilityAssignment = accountabilityDomainKey
    ? assignAccountabilityDomain({ targetType: "task", targetKey: task.key, domainKey: accountabilityDomainKey })
    : null

  return NextResponse.json({ ok: true, task, accountabilityAssignment })
}

export async function DELETE(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const url = new URL(request.url)
  const disabledOnly = parseBoolean(url.searchParams.get("disabledOnly") ?? url.searchParams.get("disabled_only"))
  if (!disabledOnly) {
    return NextResponse.json(
      { ok: false, error: "disabledOnly=true is required for bulk task deletion" },
      { status: 400 },
    )
  }

  const deleted = []
  const skipped = []
  for (const task of listTasks()) {
    if (task.enabled) continue
    if (task.taskType === "builtin") {
      skipped.push({ key: task.key, reason: "system-default" })
      continue
    }
    const removed = deleteCustomTaskByKey(task.key)
    if (removed) {
      deleted.push(removed)
    }
  }

  return NextResponse.json({ ok: true, deleted, skipped })
}
