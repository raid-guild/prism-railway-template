import { NextResponse } from "next/server"

import { requireCapabilityAccess } from "@/lib/admin-auth"
import { fetchPrismMemoryJson } from "@/lib/prism-memory"

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function GET() {
  const access = await requireCapabilityAccess("canViewMemory")
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  const [manifest, tags, entities, sources] = await Promise.all([
    fetchPrismMemoryJson<unknown[]>("/knowledge/indexes/manifest"),
    fetchPrismMemoryJson<Record<string, unknown>>("/knowledge/indexes/tags"),
    fetchPrismMemoryJson<Record<string, unknown>>("/knowledge/indexes/entities"),
    fetchPrismMemoryJson<{ sources?: unknown[] }>("/knowledge/sources"),
  ])
  const entries = manifest.ok && Array.isArray(manifest.data) ? manifest.data.map(record) : []
  const strings = (values: unknown[]) => Array.from(new Set(values.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()))).sort()
  return NextResponse.json({
    ok: true,
    facets: {
      kinds: strings(entries.map((entry) => entry.kind)),
      tags: tags.ok ? Object.keys(record(tags.data)).sort() : [],
      entities: entities.ok ? Object.keys(record(entities.data)).sort() : [],
      audiences: strings(entries.map((entry) => entry.audience)),
      stabilities: strings(entries.map((entry) => entry.stability)),
    },
    sources: sources.ok && Array.isArray(sources.data?.sources) ? sources.data.sources : [],
    warnings: [manifest, tags, entities, sources].filter((result) => !result.ok).map((result) => result.error),
  })
}
