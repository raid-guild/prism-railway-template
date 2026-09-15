import { timingSafeEqual } from "node:crypto"

import { authorizeExternalInterface, type HookRecord } from "@/lib/app-core"
import { getInternalServiceToken } from "@/lib/internal-service"

export type HookAccessPrincipal =
  | { kind: "service" }
  | { kind: "interface"; interfaceKey: string }

export type HookAccessResult =
  | { ok: true; principal: HookAccessPrincipal }
  | { ok: false; status: number; error: string }

function bearerCredential(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() ?? ""
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : ""
}

function equalCredential(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, "utf8")
  const expectedBuffer = Buffer.from(expected, "utf8")
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function configuredInterfaceKey(hook: HookRecord) {
  const value = hook.authConfig.interfaceKey ?? hook.authConfig.interface_key
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

export function hookResultArtifactNames(hook: HookRecord) {
  const value = hook.authConfig.resultArtifactNames ?? hook.authConfig.result_artifact_names
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim())))
    : []
}

export async function authorizeHookAccess(
  request: Request,
  hook: HookRecord,
  authorizeInterface: typeof authorizeExternalInterface = authorizeExternalInterface,
): Promise<HookAccessResult> {
  const serviceCredential = request.headers.get("x-service-token")?.trim() || bearerCredential(request)
  if (serviceCredential && equalCredential(serviceCredential, getInternalServiceToken())) {
    return { ok: true, principal: { kind: "service" } }
  }

  if (hook.authMode !== "interface-token") {
    return { ok: false, status: 401, error: "Unauthorized" }
  }

  const interfaceKey = request.headers.get("x-prism-interface-id")?.trim().toLowerCase() ?? ""
  const expectedInterfaceKey = configuredInterfaceKey(hook)
  if (!interfaceKey || !expectedInterfaceKey || interfaceKey !== expectedInterfaceKey) {
    return { ok: false, status: 403, error: "HOOK_INTERFACE_NOT_ALLOWED" }
  }

  const credential = request.headers.get("x-prism-interface-key")?.trim() || bearerCredential(request)
  const authorization = authorizeInterface({
    key: interfaceKey,
    credential,
    origin: request.headers.get("origin"),
    requestId: request.headers.get("x-prism-request-id"),
    subject: request.headers.get("x-prism-external-subject"),
  })
  if (!authorization.ok) {
    const status = authorization.code === "EXTERNAL_INTERFACE_NOT_FOUND" ? 404
      : authorization.code === "EXTERNAL_INTERFACE_DISABLED" ? 409
        : authorization.code === "EXTERNAL_INTERFACE_ORIGIN_DENIED" ? 403
          : 401
    return { ok: false, status, error: authorization.code }
  }

  return { ok: true, principal: { kind: "interface", interfaceKey } }
}
