export interface AgentTargetAppInput {
  slug: string
  name: string
  description: string | null
  repoUrl: string
  defaultBranch: string
}

export type AgentTargetAppInputResult =
  | { ok: true; input: AgentTargetAppInput }
  | { ok: false; error: string }

export interface AgentTargetAppPatchInput {
  name?: string
  description?: string | null
  repoUrl?: string | null
  defaultBranch?: string
  agentEnabled?: boolean
}

export type AgentTargetAppPatchInputResult =
  | { ok: true; input: AgentTargetAppPatchInput }
  | { ok: false; error: string }

export function slugFromName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function normalizeGitHubRepoUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  if (
    url.protocol !== "https:"
    || url.hostname.toLowerCase() !== "github.com"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    return null
  }

  const segments = url.pathname.split("/").filter(Boolean)
  if (segments.length !== 2) return null
  const owner = segments[0]
  const repo = segments[1].replace(/\.git$/i, "")
  if (!owner || !repo) return null

  return `https://github.com/${owner}/${repo}`
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function isValidBranch(value: string) {
  return value.length <= 255 && !/[\u0000-\u001f\u007f\s]/.test(value)
}

export function parseAgentTargetAppInput(body: Record<string, unknown> | null): AgentTargetAppInputResult {
  const rawRepoUrl = text(body?.repoUrl ?? body?.repo_url)
  const repoUrl = normalizeGitHubRepoUrl(rawRepoUrl)
  if (!repoUrl) {
    return { ok: false, error: "repoUrl must be an HTTPS GitHub repository URL" }
  }

  const repoName = repoUrl.split("/").at(-1) ?? ""
  const name = text(body?.name) || repoName
  const rawSlug = text(body?.slug)
  const slug = rawSlug || slugFromName(name)
  const defaultBranch = text(body?.defaultBranch ?? body?.default_branch) || "main"
  const description = text(body?.description) || null

  if (!name || name.length > 200) return { ok: false, error: "name must be 1-200 characters" }
  if (!slug || slug.length > 100 || slug !== slugFromName(slug)) {
    return { ok: false, error: "slug must contain only lowercase letters, numbers, and hyphens" }
  }
  if (!isValidBranch(defaultBranch)) {
    return { ok: false, error: "defaultBranch is invalid" }
  }
  if (description && description.length > 2000) {
    return { ok: false, error: "description must be at most 2000 characters" }
  }

  return { ok: true, input: { slug, name, description, repoUrl, defaultBranch } }
}

export function parseAgentTargetAppPatchInput(body: Record<string, unknown> | null): AgentTargetAppPatchInputResult {
  if (!body) return { ok: false, error: "Invalid JSON body" }

  const input: AgentTargetAppPatchInput = {}

  if (body.name !== undefined) {
    const name = text(body.name)
    if (!name || name.length > 200) return { ok: false, error: "name must be 1-200 characters" }
    input.name = name
  }

  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      return { ok: false, error: "description must be a string or null" }
    }
    const description = text(body.description) || null
    if (description && description.length > 2000) {
      return { ok: false, error: "description must be at most 2000 characters" }
    }
    input.description = description
  }

  if (body.repoUrl !== undefined || body.repo_url !== undefined) {
    const rawRepoUrl = body.repoUrl ?? body.repo_url
    if (rawRepoUrl === null || rawRepoUrl === "") {
      input.repoUrl = null
    } else {
      const repoUrl = normalizeGitHubRepoUrl(text(rawRepoUrl))
      if (!repoUrl) return { ok: false, error: "repoUrl must be an HTTPS GitHub repository URL or null" }
      input.repoUrl = repoUrl
    }
  }

  if (body.defaultBranch !== undefined || body.default_branch !== undefined) {
    const defaultBranch = text(body.defaultBranch ?? body.default_branch)
    if (!defaultBranch || !isValidBranch(defaultBranch)) {
      return { ok: false, error: "defaultBranch is invalid" }
    }
    input.defaultBranch = defaultBranch
  }

  if (body.agentEnabled !== undefined || body.agent_enabled !== undefined) {
    const agentEnabled = body.agentEnabled ?? body.agent_enabled
    if (typeof agentEnabled !== "boolean") {
      return { ok: false, error: "agentEnabled must be a boolean" }
    }
    input.agentEnabled = agentEnabled
  }

  if (Object.keys(input).length === 0) {
    return { ok: false, error: "No supported target app fields were provided" }
  }

  return { ok: true, input }
}

export function shouldSyncDefaultEnvironmentBranch(input: {
  environmentSlug: string
  environmentBranch: string | null
  targetSlug: string
  previousDefaultBranch: string | null
}) {
  return input.environmentSlug === `${input.targetSlug}-default`
    || input.environmentBranch === input.previousDefaultBranch
}
