import { createHash } from "node:crypto"
import { NextResponse } from "next/server"

import { getSessionSummary } from "@/lib/app-core"
import { requireLocalMemberAccess } from "@/lib/local-admin-api"
import {
  artifactIdFromMemoryInboxPath,
  memoryDocumentMaxBytes,
  validateMemoryDocumentUpload,
} from "@/lib/memory-document-upload"

type MemoryInboxResponse = {
  path?: string
  artifact_id?: string
  artifact_url?: string
  status?: string
  error?: { code?: string; message?: string } | string
  detail?: { error?: { code?: string; message?: string } }
}

function prismMemoryBaseUrl() {
  return (process.env.PRISM_MEMORY_BASE_URL ?? process.env.PRISM_API_BASE ?? "")
    .trim()
    .replace(/\/+$/, "")
}

function prismMemoryWriteKey() {
  return (process.env.PRISM_API_WRITE_KEY ?? process.env.PRISM_API_KEY ?? "").trim()
}

function upstreamError(payload: MemoryInboxResponse, status: number) {
  if (typeof payload.error === "string") return payload.error
  return payload.error?.message ?? payload.detail?.error?.message ?? `Prism Memory returned ${status}`
}

export async function POST(request: Request) {
  const access = await requireLocalMemberAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10)
  const maxBytes = memoryDocumentMaxBytes()
  if (Number.isFinite(contentLength) && contentLength > maxBytes + 128 * 1024) {
    return NextResponse.json({ ok: false, error: "Upload request exceeds the configured limit" }, { status: 413 })
  }

  const formData = await request.formData().catch(() => null)
  const file = formData?.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "A Markdown file is required" }, { status: 400 })
  }
  if (file.size > maxBytes) {
    return NextResponse.json(
      { ok: false, error: `File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit` },
      { status: 413 },
    )
  }

  let document
  try {
    document = validateMemoryDocumentUpload({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      maxBytes,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Markdown upload"
    return NextResponse.json(
      { ok: false, error: message },
      { status: /upload limit/.test(message) ? 413 : 400 },
    )
  }

  const baseUrl = prismMemoryBaseUrl()
  const writeKey = prismMemoryWriteKey()
  if (!baseUrl || !writeKey) {
    return NextResponse.json(
      { ok: false, error: "Prism Memory document upload is not configured" },
      { status: 503 },
    )
  }

  const uploader = access.userId ? getSessionSummary(access.userId) : null
  const author = uploader?.displayName ?? uploader?.handle ?? uploader?.email ?? "prism-contributor"
  const createdAt = new Date().toISOString()
  const sha256 = createHash("sha256").update(document.content, "utf8").digest("hex")
  const startedAt = Date.now()

  try {
    const response = await fetch(`${baseUrl}/memory/inbox`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "X-Prism-Api-Key": writeKey,
      },
      body: JSON.stringify({
        source: "prism-site",
        type: "working_document",
        ts: createdAt,
        content: document.content,
        author,
        metadata: {
          title: document.title,
          original_filename: document.filename,
          mime_type: "text/markdown",
          size_bytes: document.sizeBytes,
          content_sha256: sha256,
          document_state: "working",
          uploaded_via: "prism-site",
          uploaded_by_user_id: access.userId ?? null,
        },
      }),
    })
    const payload = (await response.json().catch(() => ({}))) as MemoryInboxResponse
    if (!response.ok || !payload.path) {
      console.warn(JSON.stringify({
        event: "memory_document_upload.upstream_failed",
        filename: document.filename,
        sizeBytes: document.sizeBytes,
        hashPrefix: sha256.slice(0, 12),
        upstreamStatus: response.status,
        durationMs: Date.now() - startedAt,
      }))
      return NextResponse.json(
        { ok: false, error: upstreamError(payload, response.status) },
        { status: response.status >= 500 ? 502 : response.status },
      )
    }

    const artifactId = payload.artifact_id ?? artifactIdFromMemoryInboxPath(payload.path)
    const viewUrl = `/admin/memory/artifacts/${encodeURIComponent(artifactId)}`
    console.info(JSON.stringify({
      event: "memory_document_upload.accepted",
      artifactId,
      filename: document.filename,
      sizeBytes: document.sizeBytes,
      hashPrefix: sha256.slice(0, 12),
      upstreamStatus: response.status,
      durationMs: Date.now() - startedAt,
    }))
    return NextResponse.json({
      ok: true,
      artifact: {
        id: artifactId,
        category: "memory",
        status: payload.status ?? "incoming",
        source: "prism-site",
        type: "working_document",
        title: document.title,
        filename: document.filename,
        createdAt,
        contentLength: document.content.length,
        preview: document.content.slice(0, 240),
        path: payload.path,
        viewUrl,
      },
    })
  } catch (error) {
    console.warn(JSON.stringify({
      event: "memory_document_upload.upstream_failed",
      filename: document.filename,
      sizeBytes: document.sizeBytes,
      hashPrefix: sha256.slice(0, 12),
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "request failed",
    }))
    return NextResponse.json(
      { ok: false, error: "Prism Memory could not be reached; retry is safe" },
      { status: 502 },
    )
  }
}
