import { NextResponse } from "next/server"

import { requireLocalMemberAccess } from "@/lib/local-admin-api"
import { proxyPrismMemoryJson, type PrismArtifactDetail } from "@/lib/prism-memory"

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireLocalMemberAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await params
  const response = await proxyPrismMemoryJson(
    `/api/artifacts/${encodeURIComponent(id)}`,
    new URL(request.url).searchParams,
  )
  if (!response.ok) return response
  const artifact = await response.json().catch(() => null) as PrismArtifactDetail | null
  if (!artifact) {
    return NextResponse.json({ ok: false, error: "Artifact not found" }, { status: 404 })
  }

  const metadata = artifact.payload?.metadata
  const title = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? String((metadata as Record<string, unknown>).title ?? artifact.filename)
    : artifact.filename
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Prism Memory</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    main { max-width: 920px; margin: 0 auto; padding: 32px 20px 56px; }
    header { border-bottom: 1px solid color-mix(in srgb, CanvasText 18%, transparent); margin-bottom: 24px; padding-bottom: 18px; }
    h1 { font-size: 28px; line-height: 1.2; margin: 0 0 12px; }
    dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 16px; margin: 0; opacity: .72; font-size: 14px; }
    dt { font-weight: 700; } dd { margin: 0; overflow-wrap: anywhere; }
    article { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 12px; padding: 20px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.65 ui-monospace, monospace; margin: 0; }
    a { color: LinkText; }
  </style>
</head>
<body>
  <main>
    <header>
      <p><a href="/admin/memory">← Memory Explorer</a></p>
      <h1>${escapeHtml(title)}</h1>
      <dl>
        <dt>Artifact</dt><dd>${escapeHtml(artifact.id)}</dd>
        <dt>Status</dt><dd>${escapeHtml(artifact.status)}</dd>
        <dt>Uploaded</dt><dd>${escapeHtml(artifact.created_at)}</dd>
        <dt>Filename</dt><dd>${escapeHtml(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>).original_filename : artifact.filename)}</dd>
      </dl>
    </header>
    <article><pre>${escapeHtml(artifact.content)}</pre></article>
  </main>
</body>
</html>`
  return new Response(html, {
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
    },
  })
}
