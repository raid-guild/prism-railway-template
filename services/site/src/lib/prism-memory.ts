import { NextResponse } from "next/server"

import { adminFetch } from "@/lib/admin"
import { requireCapabilityAccess } from "@/lib/admin-auth"

export type PrismArtifactSummary = {
  id: string
  category: string
  status: string
  path: string
  filename: string
  source?: string | null
  type?: string | null
  created_at: string
  bucket?: string | null
  author?: string | null
  url?: string | null
  participants?: string[] | null
  participant_count?: number | null
  content_length: number
  preview: string
  view_url?: string | null
  doc_url?: string | null
}

export type PrismArtifactDetail = PrismArtifactSummary & {
  content: string
  payload: Record<string, unknown>
}

export type PrismKnowledgeSource = {
  id: string
  kind: string
  repo_url: string
  branch: string
  label: string
  content_policy: string
  docs_roots: string[]
  include: string[]
  exclude: string[]
  sync_mode: string
  managed_by: string
  default_kind: string
  default_tags: string[]
  owner: string
  audience: string
  stability: string
  status: string
  last_synced_commit?: string | null
  last_synced_at?: string | null
  created_at: string
  updated_at: string
  state: {
    source_id: string
    status: string
    last_requested_at?: string | null
    last_started_at?: string | null
    last_completed_at?: string | null
    last_synced_at?: string | null
    last_synced_commit?: string | null
    file_count: number
    doc_count: number
    docs_roots: string[]
    change_summary: Record<string, number>
    error?: { code?: string; message?: string } | null
    current_step?: string | null
  }
}

export type PrismStateSignal = {
  signal_id: string
  kind: string
  anchor: string
  source: string
  source_type?: string | null
  source_record_id?: string | null
  occurred_at: string
  confidence_score?: number | null
  confidence_reasons?: string[]
  objective_key?: string | null
  throughline_key?: string | null
  evidence?: Record<string, unknown>
  external_ref?: Record<string, unknown>
}

export type PrismStateObjective = {
  objective_key: string
  title: string
  status: string
  anchors: string[]
  signal_ids: string[]
  sources: string[]
  aliases?: string[]
  owners?: string[]
  external_refs?: Array<Record<string, unknown>>
  archived?: boolean
  summary?: string
  last_signal_at?: string | null
  last_enriched_at?: string | null
  enrichment_status?: string | null
  activity_score?: number | null
  attention_score?: number | null
  confidence_score?: number | null
  score_reasons?: string[]
}

export type PrismStateThroughline = {
  throughline_key: string
  title: string
  summary?: string
  status: string
  objective_keys: string[]
  signal_ids: string[]
  last_signal_at?: string | null
  enrichment_status?: string | null
}

function prismMemoryBaseUrl() {
  return (
    process.env.PRISM_MEMORY_BASE_URL ||
    process.env.PRISM_API_BASE ||
    ""
  ).trim().replace(/\/+$/, "")
}

export function isPrismMemoryConfigured() {
  return Boolean(prismMemoryBaseUrl())
}

function prismMemoryReadKey() {
  return (
    process.env.PRISM_API_READ_KEY ||
    process.env.PRISM_API_KEY ||
    ""
  ).trim()
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function slugFromKnowledgeViewUrl(value: unknown) {
  const raw = stringValue(value)
  if (!raw) return null

  let pathname = raw
  try {
    pathname = new URL(raw).pathname
  } catch {
    // Relative paths are expected from Prism Memory and do not need URL parsing.
  }

  const marker = "/knowledge/view/"
  const markerIndex = pathname.indexOf(marker)
  if (markerIndex < 0) return null

  const slug = normalizeKnowledgeSlug(
    pathname.slice(markerIndex + marker.length),
  )
  return slug || null
}

function slugFromKnowledgeDocArtifactId(value: unknown) {
  const id = stringValue(value)
  if (!id?.startsWith("knowledge-doc--")) return null
  return (
    id
      .slice("knowledge-doc--".length)
      .replace(/~/g, "/")
      .replace(/^\/+|\/+$/g, "") || null
  )
}

function slugFromKnowledgeDocPath(value: unknown) {
  const path = stringValue(value)
  if (!path) return null

  const marker = "knowledge/kb/docs/"
  const markerIndex = path.indexOf(marker)
  if (markerIndex < 0) return null

  return path
    .slice(markerIndex + marker.length)
    .replace(/\.md$/i, "")
    .replace(/^\/+|\/+$/g, "") || null
}

function decodeSlugSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function decodeProxyPathSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

function isSafePrismMemoryProxyPath(path: string) {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\u0000-\u001f\u007f\\?#]/.test(path)
  ) {
    return false
  }

  const segments = path.split("/")
  return segments.every((segment, index) => {
    if (!segment) return index === 0

    const decoded = decodeProxyPathSegment(segment)
    return Boolean(
      decoded &&
      decoded !== "." &&
      decoded !== ".." &&
      !decoded.includes("/") &&
      !decoded.includes("\\"),
    )
  })
}

function normalizeKnowledgeSlug(slug: string) {
  return slug
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map(decodeSlugSegment)
    .join("/")
}

function encodeKnowledgeSlug(slug: string) {
  return slug
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function artifactKnowledgeViewSlug(artifact: PrismArtifactDetail) {
  const payload = recordValue(artifact.payload)
  const metadata = recordValue(payload?.metadata)

  const linkedSlug = [
    artifact.view_url,
    artifact.doc_url,
    payload?.view_url,
    payload?.doc_url,
    payload?.url,
    metadata?.view_url,
    metadata?.doc_url,
    metadata?.url,
  ]
    .map(slugFromKnowledgeViewUrl)
    .find(Boolean)
  if (linkedSlug) return linkedSlug

  const isKnowledgeDoc =
    artifact.category === "knowledge" &&
    artifact.status === "processed" &&
    artifact.type === "knowledge_doc"
  if (!isKnowledgeDoc) return null

  return (
    stringValue(payload?.slug) ||
    stringValue(metadata?.slug) ||
    slugFromKnowledgeDocArtifactId(artifact.id) ||
    slugFromKnowledgeDocPath(artifact.path)
  )
}

export function withAdminMemoryArtifactViewUrl(artifact: PrismArtifactDetail) {
  if (artifact.category === "memory") {
    return {
      ...artifact,
      view_url: `/admin/memory/artifacts/${encodeURIComponent(artifact.id)}`,
    }
  }
  const slug = artifactKnowledgeViewSlug(artifact)
  return {
    ...artifact,
    view_url: slug ? `/admin/memory/view/${encodeKnowledgeSlug(slug)}` : null,
  }
}

function useLocalAppApi() {
  return process.env.SITE_USE_LOCAL_APP_API?.trim() === "true"
}

async function requireAdminAccess() {
  const session = await requireCapabilityAccess("canViewMemory")
  if (!session.ok) {
    return {
      ok: false as const,
      status: session.status,
      error: session.error,
    }
  }

  if (useLocalAppApi()) {
    return { ok: true as const }
  }

  try {
    const response = await adminFetch("/api/admin/setup/status")
    if (response.ok) {
      return { ok: true as const }
    }

    if (response.status === 401) {
      return {
        ok: false as const,
        status: 401,
        error: "Unauthorized",
      }
    }

    return {
      ok: false as const,
      status: 502,
      error: `Admin API request failed with ${response.status}`,
    }
  } catch (error) {
    return {
      ok: false as const,
      status: 502,
      error:
        error instanceof Error
          ? error.message
          : "Admin API request failed",
    }
  }
}

export async function fetchPrismMemoryJson<T = unknown>(
  path: string,
  incomingSearchParams: URLSearchParams = new URLSearchParams(),
  allowedParams: string[] = [],
) {
  const baseUrl = prismMemoryBaseUrl()
  const readKey = prismMemoryReadKey()
  if (!baseUrl) return { ok: false as const, status: 503, error: "PRISM_MEMORY_BASE_URL is not configured", data: null }
  if (!readKey) return { ok: false as const, status: 503, error: "PRISM_API_READ_KEY or PRISM_API_KEY is not configured", data: null }
  if (!isSafePrismMemoryProxyPath(path)) return { ok: false as const, status: 400, error: "Invalid Prism Memory proxy path", data: null }

  const url = new URL(`${baseUrl}${path}`)
  const safeParams = copyAllowedSearchParams(incomingSearchParams, allowedParams)
  for (const [key, value] of safeParams.entries()) url.searchParams.set(key, value)
  try {
    const response = await fetch(url, { cache: "no-store", headers: { "X-Prism-Api-Key": readKey } })
    const data = await response.json().catch(() => null) as T | null
    if (!response.ok) {
      const payload = recordValue(data)
      const nestedError = recordValue(payload?.error)
      return {
        ok: false as const,
        status: response.status,
        error: stringValue(payload?.detail) ?? stringValue(payload?.error) ?? stringValue(nestedError?.message) ?? `Prism Memory returned ${response.status}`,
        data,
      }
    }
    return { ok: true as const, status: response.status, error: null, data: data as T }
  } catch (error) {
    return { ok: false as const, status: 502, error: error instanceof Error ? error.message : "Prism Memory request failed", data: null }
  }
}

function copyAllowedSearchParams(
  source: URLSearchParams,
  allowedParams: string[],
) {
  const output = new URLSearchParams()
  for (const key of allowedParams) {
    const value = source.get(key)
    if (value !== null && value.trim() !== "") {
      output.set(key, value)
    }
  }
  return output
}

export async function proxyPrismMemoryResponse(
  path: string,
  incomingSearchParams: URLSearchParams,
  allowedParams: string[] = [],
) {
  const access = await requireAdminAccess()
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    )
  }

  const baseUrl = prismMemoryBaseUrl()
  const readKey = prismMemoryReadKey()

  if (!baseUrl) {
    return NextResponse.json(
      { ok: false, error: "PRISM_MEMORY_BASE_URL is not configured" },
      { status: 500 },
    )
  }

  if (!readKey) {
    return NextResponse.json(
      { ok: false, error: "PRISM_API_READ_KEY or PRISM_API_KEY is not configured" },
      { status: 500 },
    )
  }

  if (!isSafePrismMemoryProxyPath(path)) {
    return NextResponse.json(
      { ok: false, error: "Invalid Prism Memory proxy path" },
      { status: 400 },
    )
  }

  const url = new URL(`${baseUrl}${path}`)
  const safeParams = copyAllowedSearchParams(incomingSearchParams, allowedParams)
  for (const [key, value] of safeParams.entries()) {
    url.searchParams.set(key, value)
  }

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "X-Prism-Api-Key": readKey,
      },
    })
    const text = await response.text()
    const contentType = response.headers.get("content-type") ?? "application/json"

    return new NextResponse(text, {
      status: response.status,
      headers: {
        "content-type": contentType,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Prism Memory request failed",
      },
      { status: 502 },
    )
  }
}

export async function proxyPrismMemoryJson(
  path: string,
  incomingSearchParams: URLSearchParams,
  allowedParams: string[] = [],
) {
  return proxyPrismMemoryResponse(path, incomingSearchParams, allowedParams)
}
