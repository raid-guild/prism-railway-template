import { NextResponse } from "next/server"

import { getHookByKey } from "@/lib/app-core"
import { authorizeHookAccess } from "@/lib/hook-auth"
import { triggerHook } from "@/lib/hook-trigger"

type RouteContext = {
  params: Promise<{ key: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const { key: rawKey } = await context.params
  const key = decodeURIComponent(rawKey)
  const hook = getHookByKey(key)
  if (!hook) {
    return NextResponse.json({ ok: false, error: "HOOK_NOT_FOUND" }, { status: 404 })
  }
  const access = await authorizeHookAccess(request, hook)
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null
  try {
    const result = await triggerHook(key, payload ?? {}, {
      baseUrl: new URL(request.url).origin,
      source: access.principal.kind === "interface"
        ? `hook:${hook.key}:external-interface:${access.principal.interfaceKey}`
        : `hook:${hook.key}`,
      waitForAutoStart: false,
    })
    if (access.principal.kind === "interface") {
      const requestNumber = result.changeRequest.requestNumber
      return NextResponse.json({
        ok: true,
        status: result.autoStartQueued ? "queued" : "created",
        changeRequest: {
          id: result.changeRequest.id,
          requestNumber,
          title: result.changeRequest.title,
          workflowKey: result.changeRequest.workflowKey,
          currentWorkflowStepKey: result.changeRequest.currentWorkflowStepKey,
        },
        autoStartQueued: Boolean(result.autoStartQueued),
        resultUrl: `/agent/hooks/${encodeURIComponent(hook.key)}/requests/${requestNumber}/result`,
      }, { status: result.autoStartQueued ? 202 : 200 })
    }
    return NextResponse.json({ ok: true, ...result }, { status: result.autoStartQueued ? 202 : 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not trigger hook"
    const status = message === "HOOK_NOT_FOUND" ? 404 : message === "HOOK_DISABLED" ? 409 : 400
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
