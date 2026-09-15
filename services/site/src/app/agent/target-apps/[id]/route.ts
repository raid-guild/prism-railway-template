import { NextResponse } from "next/server"
import {
  createAuditLog,
  getDefaultTargetEnvironmentForApp,
  getTargetApp,
  updateTargetApp,
  updateTargetEnvironment,
} from "@/lib/app-core"

import { requireServiceAccess } from "@/lib/internal-service"
import {
  parseAgentTargetAppPatchInput,
  shouldSyncDefaultEnvironmentBranch,
} from "@/lib/target-app-input"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const targetAppId = (await context.params).id.trim()
  const existing = getTargetApp(targetAppId)
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Target app not found" }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const parsed = parseAgentTargetAppPatchInput(body)
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  }

  try {
    const targetApp = updateTargetApp(targetAppId, parsed.input)
    if (!targetApp) {
      return NextResponse.json({ ok: false, error: "Target app not found" }, { status: 404 })
    }

    let targetEnvironment = getDefaultTargetEnvironmentForApp(targetApp.id)
    let defaultEnvironmentBranchSynced = false
    if (
      parsed.input.defaultBranch !== undefined
      && targetEnvironment
      && shouldSyncDefaultEnvironmentBranch({
        environmentSlug: targetEnvironment.slug,
        environmentBranch: targetEnvironment.branch,
        targetSlug: existing.slug,
        previousDefaultBranch: existing.defaultBranch,
      })
    ) {
      const updatedEnvironment = updateTargetEnvironment(targetEnvironment.id, {
        branch: targetApp.defaultBranch,
      })
      if (updatedEnvironment) {
        targetEnvironment = updatedEnvironment
        defaultEnvironmentBranchSynced = true
      }
    }

    createAuditLog({
      actorUserId: null,
      actionType: "agent.target_app.update",
      targetType: "target_app",
      targetId: targetApp.id,
      meta: {
        changedFields: Object.keys(parsed.input),
        name: targetApp.name,
        repoUrl: targetApp.repoUrl,
        defaultBranch: targetApp.defaultBranch,
        agentEnabled: targetApp.agentEnabled,
        defaultEnvironmentBranchSynced,
        targetEnvironmentId: targetEnvironment?.id ?? null,
      },
    })

    return NextResponse.json({
      ok: true,
      targetApp,
      targetEnvironment,
      defaultEnvironmentBranchSynced,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update target app"
    const status = /UNIQUE constraint failed/.test(message) ? 409 : 400
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
