import { NextResponse } from "next/server"

import { deleteCustomHookByKey, getHookByKey, upsertHook } from "@/lib/app-core"
import { parseNullableString, parseString, requireServiceAccess } from "@/lib/internal-service"
import { parseBoolean, parseConfig } from "@/lib/parse-utils"

type RouteContext = {
  params: Promise<{ key: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }
  const { key } = await context.params
  const hook = getHookByKey(decodeURIComponent(key))
  if (!hook) {
    return NextResponse.json({ ok: false, error: "Hook not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true, hook })
}

export async function PATCH(request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }
  const { key } = await context.params
  const existing = getHookByKey(decodeURIComponent(key))
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Hook not found" }, { status: 404 })
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  try {
    const hook = upsertHook({
      key: existing.key,
      name: parseString(body?.name) || existing.name,
      description: body?.description === undefined ? existing.description : parseNullableString(body.description) ?? null,
      enabled: body?.enabled === undefined ? existing.enabled : parseBoolean(body.enabled),
      workflowKey: parseString(body?.workflowKey ?? body?.workflow_key) || existing.workflowKey,
      authMode: parseString(body?.authMode ?? body?.auth_mode) || existing.authMode,
      authConfig:
        body?.authConfig !== undefined || body?.auth_config !== undefined
          ? parseConfig(body.authConfig ?? body.auth_config)
          : existing.authConfig,
      requestTemplate:
        body?.requestTemplate !== undefined || body?.request_template !== undefined
          ? parseConfig(body.requestTemplate ?? body.request_template)
          : existing.requestTemplate,
      autoRun:
        body?.autoRun !== undefined || body?.auto_run !== undefined
          ? parseConfig(body.autoRun ?? body.auto_run)
          : existing.autoRun,
      systemDefault: existing.systemDefault,
    })
    return NextResponse.json({ ok: true, hook })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not update hook" },
      { status: 400 },
    )
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }
  const { key } = await context.params
  try {
    const hook = deleteCustomHookByKey(decodeURIComponent(key))
    if (!hook) {
      return NextResponse.json({ ok: false, error: "Hook not found" }, { status: 404 })
    }
    return NextResponse.json({ ok: true, hook })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete hook"
    const status = message === "HOOK_DELETE_SYSTEM_DEFAULT" ? 409 : 400
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
