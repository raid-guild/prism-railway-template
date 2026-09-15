import { trackedChangeRequestPriorities, trackedChangeRequestTypes } from "@/lib/local-admin-api"

export type ConsolePromotionInput = {
  sessionId: string
  title: string
  description: string
  workflowKey: string
  targetAppId: string | null
  requestType: typeof trackedChangeRequestTypes[number]
  priority: typeof trackedChangeRequestPriorities[number]
}
function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function boundedText(value: unknown, max: number) {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text && text.length <= max ? text : null
}

export function parseConsolePromotion(value: unknown):
  | { ok: true; value: ConsolePromotionInput }
  | { ok: false; error: string } {
  const body = record(value)
  const sessionId = boundedText(body.sessionId ?? body.session_id, 200)
  const title = boundedText(body.title, 200)
  const description = boundedText(body.description, 12_000)
  const workflowKey = boundedText(body.workflowKey ?? body.workflow_key, 120)
  const targetAppId = boundedText(body.targetAppId ?? body.target_app_id, 200)
  const requestType = boundedText(body.requestType ?? body.request_type, 40)
  const priority = boundedText(body.priority, 40)
  if (!sessionId || !title || !description || !workflowKey) {
    return { ok: false, error: "sessionId, title, description, and workflowKey are required and must be within limits" }
  }
  if (!requestType || !trackedChangeRequestTypes.includes(requestType as ConsolePromotionInput["requestType"])) {
    return { ok: false, error: "Unsupported request type" }
  }
  if (!priority || !trackedChangeRequestPriorities.includes(priority as ConsolePromotionInput["priority"])) {
    return { ok: false, error: "Unsupported priority" }
  }
  return {
    ok: true,
    value: {
      sessionId,
      title,
      description,
      workflowKey,
      targetAppId,
      requestType: requestType as ConsolePromotionInput["requestType"],
      priority: priority as ConsolePromotionInput["priority"],
    },
  }
}

const configurationPrompts: Record<string, string> = {
  gateway: "Prepare a proposed non-secret Gateway configuration plan for operator review. Do not request credentials and do not apply changes.",
  interfaces: "Prepare a proposed non-secret external interface configuration plan for operator review. Do not request or generate an API key and do not apply changes.",
  runtimes: "Review the runtime-profile setup and prepare a non-secret routing configuration plan. Do not request provider credentials and do not apply changes.",
  sources: "Prepare a proposed source access-policy change for operator review. Explain the affected platform, target, access mode, and risks; do not apply changes.",
}

export function configurationPromptForFocus(focus: string | null | undefined) {
  return focus ? configurationPrompts[focus] ?? "" : ""
}
