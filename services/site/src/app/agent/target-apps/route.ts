import { NextResponse } from "next/server"
import {
  createAuditLog,
  createTargetApp,
  createTargetEnvironment,
  getDefaultTargetEnvironmentForApp,
  listTargetApps,
  listTargetEnvironments,
  updateTargetEnvironment,
  type TargetAppRecord,
} from "@/lib/app-core"

import { requireServiceAccess } from "@/lib/internal-service"
import { normalizeGitHubRepoUrl, parseAgentTargetAppInput } from "@/lib/target-app-input"

export async function GET() {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json({ ok: true, targetApps: listTargetApps() })
}

function ensureDefaultEnvironment(targetApp: TargetAppRecord) {
  const currentDefault = getDefaultTargetEnvironmentForApp(targetApp.id)
  if (currentDefault) return { environment: currentDefault, created: false }

  const environmentSlug = `${targetApp.slug}-default`
  const existing = listTargetEnvironments(targetApp.id).find((environment) => environment.slug === environmentSlug)
  if (existing) {
    return {
      environment: updateTargetEnvironment(existing.id, {
        branch: targetApp.defaultBranch,
        agentWritable: true,
        isDefaultForAgent: true,
      }),
      created: false,
    }
  }

  return {
    environment: createTargetEnvironment({
      targetAppId: targetApp.id,
      slug: environmentSlug,
      name: "Default",
      kind: "development",
      branch: targetApp.defaultBranch,
      baseUrl: null,
      deployBackend: "local",
      deployConfig: { path: "/data/workspaces" },
      agentWritable: true,
      autoDeployEnabled: false,
      humanReviewRequired: true,
      isDefaultForAgent: true,
    }),
    created: true,
  }
}

export async function POST(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const parsed = parseAgentTargetAppInput(body)
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  }

  const input = parsed.input
  const targetApps = listTargetApps()
  const existingByRepo = targetApps.find((targetApp) => (
    targetApp.repoUrl
    && normalizeGitHubRepoUrl(targetApp.repoUrl)?.toLowerCase() === input.repoUrl.toLowerCase()
  ))
  const existingBySlug = targetApps.find((targetApp) => targetApp.slug === input.slug)

  if (existingBySlug && existingBySlug.id !== existingByRepo?.id) {
    return NextResponse.json(
      { ok: false, error: `A target app with slug '${input.slug}' already exists` },
      { status: 409 },
    )
  }

  try {
    const created = !existingByRepo
    const targetApp = existingByRepo ?? createTargetApp({
      slug: input.slug,
      name: input.name,
      description: input.description,
      repoUrl: input.repoUrl,
      repoProvider: "github",
      defaultBranch: input.defaultBranch,
      framework: null,
      deployBackend: "github",
      deployConfig: { workspace: "external" },
      agentEnabled: true,
    })

    if (!targetApp) throw new Error("Could not create target app")
    const defaultEnvironment = ensureDefaultEnvironment(targetApp)
    if (!defaultEnvironment.environment) throw new Error("Could not create default target environment")

    if (created) {
      createAuditLog({
        actorUserId: null,
        actionType: "agent.target_app.create",
        targetType: "target_app",
        targetId: targetApp.id,
        meta: { slug: targetApp.slug, repoUrl: targetApp.repoUrl },
      })
    }
    if (defaultEnvironment.created) {
      createAuditLog({
        actorUserId: null,
        actionType: "agent.target_environment.create",
        targetType: "target_environment",
        targetId: defaultEnvironment.environment.id,
        meta: { targetAppId: targetApp.id, slug: defaultEnvironment.environment.slug },
      })
    }

    return NextResponse.json(
      { ok: true, created, targetApp, targetEnvironment: defaultEnvironment.environment },
      { status: created ? 201 : 200 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create target app"
    const status = /UNIQUE constraint failed/.test(message) ? 409 : 400
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
