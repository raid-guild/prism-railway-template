import { createHash } from "node:crypto"
import { headers } from "next/headers"
import { loadConfig } from "@/lib/app-core"
import {
  hasTaskRunnerMutationAccess,
  resolveTaskRunnerMutationToken,
} from "@/lib/task-runner-ledger-auth"

export function parseString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function parseNullableString(value: unknown) {
  if (value === null) return null
  return typeof value === "string" ? value.trim() : undefined
}

export function readOptionalInteger(value: string | null) {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function getInternalServiceToken() {
  const explicitToken = process.env.INTERNAL_SERVICE_TOKEN?.trim() || process.env.SERVICE_SHARED_TOKEN?.trim()
  if (explicitToken) {
    return explicitToken
  }

  return createHash("sha256")
    .update(`${loadConfig().adminPassword}:prism-agent-internal-service`)
    .digest("hex")
}

async function readServiceToken() {
  const requestHeaders = await headers()
  const directHeader = requestHeaders.get("x-service-token")?.trim()
  if (directHeader) {
    return directHeader
  }

  const authorization = requestHeaders.get("authorization")?.trim()
  if (!authorization) {
    return null
  }

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim()
  }

  return authorization
}

async function readTaskRunnerToken() {
  const requestHeaders = await headers()
  return requestHeaders.get("x-task-runner-token")?.trim() || null
}

export async function requireServiceAccess() {
  if ((await readServiceToken()) !== getInternalServiceToken()) {
    return { ok: false as const, status: 401, error: "Unauthorized" }
  }

  return { ok: true as const }
}

export async function requireTaskRunnerMutationAccess() {
  const serviceAccess = await requireServiceAccess()
  if (!serviceAccess.ok) {
    return serviceAccess
  }

  const expected = resolveTaskRunnerMutationToken(process.env)
  if (!expected) {
    return { ok: false as const, status: 503, error: "Task runner mutation token is not configured" }
  }
  if (!hasTaskRunnerMutationAccess(await readTaskRunnerToken(), expected)) {
    return { ok: false as const, status: 403, error: "Task run mutations are reserved for task-runner" }
  }

  return { ok: true as const }
}
