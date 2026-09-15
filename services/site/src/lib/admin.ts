import { getAdminBoardSnapshot, getAdminSetupStatus, loadConfig, readSiteContent, type RequestOriginSnapshot } from "@/lib/app-core"
import { requireAdminSession } from "@/lib/admin-auth"
import { getPrismUpdateStatus, type PrismUpdateStatus } from "@/lib/prism-version"
import type { Capability } from "@/lib/role-access"
import {
  projectActiveRequestAgentRuns,
  type ActiveRequestAgentRunSummary,
} from "@/lib/prism-lab/active-run-projection"

function useLocalAppApi() {
  return process.env.SITE_USE_LOCAL_APP_API?.trim() === "true"
}

export const siteApiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://127.0.0.1:3100"

export type TargetAppRecord = {
  id: string
  slug: string
  name: string
  description: string | null
  repoUrl: string | null
  repoProvider: string | null
  defaultBranch: string
  framework: string | null
  deployBackend: string
  deployConfig: Record<string, unknown>
  agentEnabled: boolean
  createdAt: string
  updatedAt: string
}

export type TargetEnvironmentRecord = {
  id: string
  targetAppId: string | null
  targetAppSlug: string | null
  slug: string
  name: string
  kind: string
  branch: string | null
  baseUrl: string | null
  deployBackend: string
  deployConfig: Record<string, unknown>
  agentWritable: boolean
  autoDeployEnabled: boolean
  humanReviewRequired: boolean
  isDefaultForAgent: boolean
  createdAt: string
  updatedAt: string
}

export type ChangeRequestRecord = {
  id: string
  requestNumber: number
  workflowKey: string
  title: string
  description: string
  requestType: string
  priority: string
  source: string
  requestedByUserId: string | null
  requestedByDisplayName: string | null
  origin?: RequestOriginSnapshot | null
  targetAppId?: string | null
  targetAppSlug: string | null
  targetAppName: string | null
  targetEnvironmentId: string | null
  targetEnvironmentSlug: string | null
  targetEnvironmentName: string | null
  currentWorkflowStepKey: string | null
  workflowRunStatus: string | null
  workflowAttention: {
    status: "blocked" | "needs_attention"
    summary: string | null
    suggestedFix: string | null
    blockers: Array<Record<string, unknown>>
    agentRunId: string
    workflowRunId: string | null
    workflowStepKey: string | null
    createdAt: string
  } | null
  triageSummary: string | null
  estimatedHumanHours: number | null
  acceptanceCriteria: unknown[]
  constraints: Record<string, unknown>
  attachments: unknown[]
  agentRecommendation: string | null
  reviewNotes: string | null
  resolutionSummary: string | null
  createdAt: string
  updatedAt: string
  triagedAt: string | null
  approvedForWorkAt: string | null
  completedAt: string | null
  closedAt: string | null
}

export type ChangeRequestExecutionRecord = {
  id: string
  changeRequestId: string
  targetEnvironmentId: string | null
  targetEnvironmentSlug: string | null
  status: string
  actorType: string
  branchName: string | null
  commitSha: string | null
  deployUrl: string | null
  adapterKind: string | null
  adapterStatus: string | null
  summary: string | null
  errorMessage: string | null
  meta: Record<string, unknown>
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type AgentRunRecord = {
  id: string
  kind: string
  status: string
  lane: string
  priority: number
  idempotencyKey: string | null
  requestId: string | null
  workflowRunId: string | null
  workflowStepKey: string | null
  taskKey: string | null
  hookKey: string | null
  sessionId: string | null
  source: string
  input: Record<string, unknown>
  result: Record<string, unknown>
  trace: Array<Record<string, unknown>>
  errorMessage: string | null
  queuedAt: string
  claimedAt: string | null
  leaseExpiresAt: string | null
  queueReason: string | null
  queuePosition: number | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type WorkflowRecord = {
  id: string
  key: string
  name: string
  description: string | null
  version: number
  definition: Record<string, unknown>
  systemDefault: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type WorkflowEventRecord = {
  id: string
  workflowRunId: string
  requestId: string
  stepKey: string | null
  eventType: string
  actorType: string
  actorId: string | null
  note: string | null
  payload: Record<string, unknown>
  createdAt: string
}

export type RequestArtifactRecord = {
  id: string
  agentRunId: string | null
  requestId: string
  workflowRunId: string | null
  executionId: string | null
  kind: string
  name: string
  description: string | null
  mimeType: string
  storagePath: string
  sizeBytes: number
  metadata: Record<string, unknown>
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type RequestExternalRefRecord = {
  id: string
  requestId: string
  provider: string
  kind: string
  externalId: string | null
  title: string | null
  url: string
  state: string | null
  metadata: Record<string, unknown>
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type AdminSetupStatus = {
  prismMemory: {
    configured: boolean
    reachable: boolean
    status: number | null
    error: string | null
    space: string | null
  }
  codexRuntime: {
    configured: boolean
    reachable: boolean
    status: number | null
    error: string | null
    codexAuthConfigured: boolean
    codexHome: string | null
  }
  targets: {
    targetAppCount: number
    targetEnvironmentCount: number
  }
  community: {
    provider: string | null
  }
}

export type AdminBoardData = {
  targetApps: TargetAppRecord[]
  targetEnvironments: TargetEnvironmentRecord[]
  changeRequests: ChangeRequestRecord[]
  workflows?: WorkflowRecord[]
  /** Non-sensitive occupancy summaries for actual active request-linked runs. */
  activeRequestAgentRuns?: ActiveRequestAgentRunSummary[]
}

export type AdminWorkspaceData = AdminBoardData & {
  setup: AdminSetupStatus
  updateStatus: PrismUpdateStatus
  branding: {
    brandName: string
    logoUrl: string
    logoAlt: string
    workspaceLabel: string
  }
  session: {
    userId: string | null
    roleSlugs: string[]
    capabilities: Capability[]
  }
}

function adminBranding() {
  const shell = readSiteContent(loadConfig()).shell
  return {
    brandName: shell.brandName || "Prism Refactory",
    logoUrl: shell.logoUrl || "",
    logoAlt: shell.logoAlt || shell.brandName || "Workspace logo",
    workspaceLabel: shell.workspaceLabel || "Admin workspace",
  }
}

export async function adminFetch(path: string, init?: RequestInit) {
  const access = await requireAdminSession()
  const adminPassword = access.ok ? loadConfig().adminPassword : null

  const response = await fetch(`${siteApiBase}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(adminPassword ? { "x-admin-password": adminPassword } : {}),
      ...(init?.headers ?? {}),
    },
  })

  return response
}

async function requireLocalAdminPassword() {
  const access = await requireAdminSession()
  if (!access.ok) {
    return { ok: false as const, reason: "missing-password" as const }
  }

  return { ok: true as const, session: access }
}

export async function getAdminBoardData(): Promise<
  { ok: true; data: AdminBoardData } | { ok: false; reason: "missing-password" | "unauthorized" | "error" }
> {
  if (useLocalAppApi()) {
    const access = await requireLocalAdminPassword()
    if (!access.ok) {
      return access
    }

    try {
      return {
        ok: true,
        data: getAdminBoardSnapshot(),
      }
    } catch {
      return { ok: false, reason: "error" }
    }
  }

  const access = await requireAdminSession()
  if (!access.ok) {
    return { ok: false, reason: "missing-password" }
  }

  try {
    const [
      targetAppsResponse,
      targetEnvironmentsResponse,
      changeRequestsResponse,
      queuedRunsResponse,
      claimedRunsResponse,
      runningRunsResponse,
    ] = await Promise.all([
      adminFetch("/api/admin/target-apps"),
      adminFetch("/api/admin/target-environments"),
      adminFetch("/api/admin/change-board/requests"),
      adminFetch("/api/admin/agent-runs?status=queued&limit=200"),
      adminFetch("/api/admin/agent-runs?status=claimed&limit=200"),
      adminFetch("/api/admin/agent-runs?status=running&limit=200"),
    ])

    if (
      targetAppsResponse.status === 401 ||
      targetEnvironmentsResponse.status === 401 ||
      changeRequestsResponse.status === 401 ||
      queuedRunsResponse.status === 401 ||
      claimedRunsResponse.status === 401 ||
      runningRunsResponse.status === 401
    ) {
      return { ok: false, reason: "unauthorized" }
    }

    if (
      !targetAppsResponse.ok ||
      !targetEnvironmentsResponse.ok ||
      !changeRequestsResponse.ok ||
      !queuedRunsResponse.ok ||
      !claimedRunsResponse.ok ||
      !runningRunsResponse.ok
    ) {
      return { ok: false, reason: "error" }
    }

    const [
      targetAppsJson,
      targetEnvironmentsJson,
      changeRequestsJson,
      queuedRunsJson,
      claimedRunsJson,
      runningRunsJson,
    ] = await Promise.all([
      targetAppsResponse.json() as Promise<{ targetApps: TargetAppRecord[] }>,
      targetEnvironmentsResponse.json() as Promise<{ targetEnvironments: TargetEnvironmentRecord[] }>,
      changeRequestsResponse.json() as Promise<{ changeRequests: ChangeRequestRecord[] }>,
      queuedRunsResponse.json() as Promise<{ runs: AgentRunRecord[] }>,
      claimedRunsResponse.json() as Promise<{ runs: AgentRunRecord[] }>,
      runningRunsResponse.json() as Promise<{ runs: AgentRunRecord[] }>,
    ])

    return {
      ok: true,
      data: {
        targetApps: targetAppsJson.targetApps,
        targetEnvironments: targetEnvironmentsJson.targetEnvironments,
        changeRequests: changeRequestsJson.changeRequests,
        workflows: [],
        activeRequestAgentRuns: projectActiveRequestAgentRuns([
          ...queuedRunsJson.runs,
          ...claimedRunsJson.runs,
          ...runningRunsJson.runs,
        ]),
      },
    }
  } catch {
    return { ok: false, reason: "error" }
  }
}

export async function getAdminWorkspaceData(): Promise<
  { ok: true; data: AdminWorkspaceData } | { ok: false; reason: "missing-password" | "unauthorized" | "error" }
> {
  if (useLocalAppApi()) {
    const access = await requireLocalAdminPassword()
    if (!access.ok) {
      return access
    }

    try {
      return {
        ok: true,
        data: {
          ...getAdminBoardSnapshot(),
          setup: await getAdminSetupStatus(),
          updateStatus: await getPrismUpdateStatus(),
          branding: adminBranding(),
          session: {
            userId: access.session.userId,
            roleSlugs: access.session.roleSlugs,
            capabilities: access.session.capabilities,
          },
        },
      }
    } catch {
      return { ok: false, reason: "error" }
    }
  }

  const access = await requireAdminSession()
  if (!access.ok) {
    return { ok: false, reason: "missing-password" }
  }

  try {
    const [board, setupResponse, updateStatus] = await Promise.all([
      getAdminBoardData(),
      adminFetch("/api/admin/setup/status"),
      getPrismUpdateStatus(),
    ])

    if (!board.ok) {
      return board
    }

    if (setupResponse.status === 401) {
      return { ok: false, reason: "unauthorized" }
    }

    if (!setupResponse.ok) {
      return { ok: false, reason: "error" }
    }

    const setupJson = (await setupResponse.json()) as {
      setup: AdminSetupStatus
    }

    return {
      ok: true,
      data: {
        ...board.data,
        setup: setupJson.setup,
        updateStatus,
        branding: adminBranding(),
        session: {
          userId: access.userId,
          roleSlugs: access.roleSlugs,
          capabilities: access.capabilities,
        },
      },
    }
  } catch {
    return { ok: false, reason: "error" }
  }
}
