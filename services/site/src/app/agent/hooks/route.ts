import { NextResponse } from "next/server"

import { listHooks, upsertHook } from "@/lib/app-core"
import { parseNullableString, parseString, requireServiceAccess } from "@/lib/internal-service"
import { parseBoolean, parseConfig } from "@/lib/parse-utils"

export async function GET() {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json({ ok: true, hooks: listHooks() })
}

export async function POST(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const key = parseString(body?.key)
  const name = parseString(body?.name)
  const workflowKey = parseString(body?.workflowKey ?? body?.workflow_key)
  if (!key || !name || !workflowKey) {
    return NextResponse.json({ ok: false, error: "key, name, and workflowKey are required" }, { status: 400 })
  }

  try {
    const hook = upsertHook({
      key,
      name,
      description: parseNullableString(body?.description) ?? null,
      enabled: parseBoolean(body?.enabled),
      workflowKey,
      authMode: parseString(body?.authMode ?? body?.auth_mode) || "service-token",
      authConfig: parseConfig(body?.authConfig ?? body?.auth_config),
      requestTemplate: parseConfig(body?.requestTemplate ?? body?.request_template),
      autoRun: parseConfig(body?.autoRun ?? body?.auto_run),
      systemDefault: parseBoolean(body?.systemDefault ?? body?.system_default),
    })
    return NextResponse.json({ ok: true, hook }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not save hook" },
      { status: 400 },
    )
  }
}
