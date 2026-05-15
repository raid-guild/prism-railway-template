import { requireCapabilityAccess, requireMemberAccess, requireModeratorAccess } from "@/lib/admin-auth"

export const targetEnvironmentKinds = ["production", "staging", "preview", "development"] as const
export const trackedChangeRequestTypes = ["bug", "feature", "issue", "content", "design", "config", "ops"] as const
export const trackedChangeRequestPriorities = ["low", "normal", "high", "urgent"] as const

export function useLocalAppApi() {
  return process.env.SITE_USE_LOCAL_APP_API?.trim() === "true"
}

export async function requireLocalAdminAccess() {
  return requireModeratorAccess()
}

export async function requireLocalMemberAccess() {
  return requireMemberAccess()
}

export async function requireLocalCommentAccess() {
  return requireCapabilityAccess("canComment")
}

export function parseString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function parseNullableString(value: unknown) {
  if (value === null) return null
  return typeof value === "string" ? value.trim() : undefined
}

export function readRouteParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? ""
}

export function hasActiveExecutionStatus(status: string) {
  return status === "planned" || status === "running"
}
