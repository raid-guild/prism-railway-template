export type LabMemoryReference =
  | { type: "rolling-day"; date: string; buckets: string[] }
  | {
      type: "knowledge-doc"
      slug: string
      sourceId: string | null
      kind: string | null
      tags: string[]
      entities: string[]
      audience: string | null
      stability: string | null
    }

export type NormalizedAgentMemoryScope = {
  workspaceWide: boolean
  buckets: string[]
  knowledgeSourceIds: string[]
  kinds: string[]
  tags: string[]
  entities: string[]
  audiences: string[]
  stabilities: string[]
  instructions: string | null
}

export type LabRollingEntry = {
  bucket: string | null
  text: string
  lastSeen: string | null
  stale: boolean
  sourceDigestPath: string | null
  evidence: Array<{
    author: string | null
    text: string
    timestamp: string | null
    jumpUrl: string | null
  }>
}

export type LabRollingDay = {
  date: string
  narrative: string | null
  sourceDigestPaths: string[]
  buckets: string[]
  sections: Record<string, LabRollingEntry[]>
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function strings(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(string).filter((item): item is string => Boolean(item))))
}

function normalizedStrings(value: unknown) {
  return strings(value).map((item) => item.toLowerCase())
}

export function normalizeAgentMemoryScope(value: unknown): NormalizedAgentMemoryScope {
  const scope = record(value) ?? {}
  const scopeName = string(scope.scope)?.toLowerCase() ?? ""
  return {
    workspaceWide: ["workspace", "workspace-read", "workspace-operational", "all"].includes(scopeName),
    buckets: normalizedStrings(scope.buckets),
    knowledgeSourceIds: strings(scope.knowledgeSourceIds ?? scope.knowledge_source_ids),
    kinds: normalizedStrings(scope.kinds),
    tags: normalizedStrings(scope.tags),
    entities: normalizedStrings(scope.entities),
    audiences: normalizedStrings(scope.audiences),
    stabilities: normalizedStrings(scope.stabilities),
    instructions: string(scope.instructions),
  }
}

function overlaps(allowed: string[], actual: string[]) {
  return allowed.length === 0 || actual.some((item) => allowed.includes(item.toLowerCase()))
}

export function agentMemoryScopeAllows(
  scopeValue: unknown,
  reference: LabMemoryReference,
) {
  const scope = normalizeAgentMemoryScope(scopeValue)
  if (scope.workspaceWide) return true

  if (reference.type === "rolling-day") {
    return reference.buckets.length > 0 && reference.buckets.every((bucket) => scope.buckets.includes(bucket.toLowerCase()))
  }

  const hasKnowledgeSelector = Boolean(
    scope.knowledgeSourceIds.length || scope.kinds.length || scope.tags.length ||
    scope.entities.length || scope.audiences.length || scope.stabilities.length,
  )
  if (!hasKnowledgeSelector) return false
  if (scope.knowledgeSourceIds.length && (!reference.sourceId || !scope.knowledgeSourceIds.includes(reference.sourceId))) return false
  if (scope.kinds.length && (!reference.kind || !scope.kinds.includes(reference.kind.toLowerCase()))) return false
  if (!overlaps(scope.tags, reference.tags)) return false
  if (!overlaps(scope.entities, reference.entities)) return false
  if (scope.audiences.length && (!reference.audience || !scope.audiences.includes(reference.audience.toLowerCase()))) return false
  if (scope.stabilities.length && (!reference.stability || !scope.stabilities.includes(reference.stability.toLowerCase()))) return false
  return true
}

function rollingEvidence(value: unknown): LabRollingEntry["evidence"][number] | null {
  const item = record(value)
  if (!item) return null
  const textValue = string(item.text)
  if (!textValue) return null
  return {
    author: string(item.author),
    text: textValue,
    timestamp: string(item.timestamp),
    jumpUrl: string(item.jump_url ?? item.jumpUrl),
  }
}

function rollingEntry(value: unknown): LabRollingEntry | null {
  const item = record(value)
  const textValue = string(item?.text)
  if (!item || !textValue) return null
  return {
    bucket: string(item.bucket),
    text: textValue,
    lastSeen: string(item.last_seen ?? item.lastSeen),
    stale: item.stale === true,
    sourceDigestPath: string(item.source_digest_path ?? item.sourceDigestPath),
    evidence: Array.isArray(item.evidence_quotes)
      ? item.evidence_quotes.map(rollingEvidence).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      : [],
  }
}

export function parseRollingDay(value: unknown): LabRollingDay | null {
  const payload = record(value)
  const date = string(payload?.date)
  if (!payload || !date || !datePattern.test(date)) return null
  const rawSections = record(payload.sections) ?? {}
  const sections: Record<string, LabRollingEntry[]> = {}
  for (const [key, rawEntries] of Object.entries(rawSections)) {
    if (!Array.isArray(rawEntries)) continue
    sections[key] = rawEntries.map(rollingEntry).filter((entry): entry is LabRollingEntry => Boolean(entry))
  }
  const sourceDigestPaths = strings(payload.source_digest_paths ?? payload.sourceDigestPaths)
  const buckets = Array.from(new Set([
    ...sourceDigestPaths.map((path) => path.match(/^buckets\/([^/]+)\//)?.[1] ?? null),
    ...Object.values(sections).flat().map((entry) => entry.bucket),
  ].filter((item): item is string => Boolean(item)))).sort()
  return { date, narrative: string(payload.narrative), sourceDigestPaths, buckets, sections }
}

export function rollingDateFromArtifact(value: unknown) {
  const artifact = record(value)
  if (!artifact) return null
  const candidates = [artifact.path, artifact.filename, artifact.id].map(string).filter(Boolean) as string[]
  for (const candidate of candidates) {
    if (/latest\.json$/i.test(candidate)) continue
    const match = candidate.match(/(?:^|\/)memory\/rolling\/(\d{4}-\d{2}-\d{2})\.json$/i)
      ?? candidate.match(/^(\d{4}-\d{2}-\d{2})\.json$/i)
    if (match?.[1] && datePattern.test(match[1])) return match[1]
  }
  return null
}

export function listRollingDatesFromArtifacts(value: unknown) {
  const payload = record(value)
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : Array.isArray(value) ? value : []
  return Array.from(new Set(artifacts.map(rollingDateFromArtifact).filter((date): date is string => Boolean(date))))
    .sort((left, right) => right.localeCompare(left))
}

export function listRollingDatesFromIndex(value: unknown) {
  const payload = record(value)
  const dates = Array.isArray(payload?.dates) ? payload.dates : []
  return Array.from(new Set(dates.map((item) => {
    if (typeof item === "string") return isValidMemoryDate(item) ? item : null
    const date = string(record(item)?.date)
    return date && isValidMemoryDate(date) ? date : null
  }).filter((date): date is string => Boolean(date)))).sort((left, right) => right.localeCompare(left))
}

export function isValidMemoryDate(value: string) {
  return datePattern.test(value)
}

export function normalizeMemoryReferences(value: unknown): Array<{ type: "rolling-day"; date: string } | { type: "knowledge-doc"; slug: string }> {
  if (!Array.isArray(value)) return []
  const output: Array<{ type: "rolling-day"; date: string } | { type: "knowledge-doc"; slug: string }> = []
  const seen = new Set<string>()
  for (const itemValue of value.slice(0, 20)) {
    const item = record(itemValue)
    const type = string(item?.type)
    if (type === "rolling-day") {
      const date = string(item?.date)
      if (!date || !isValidMemoryDate(date)) continue
      const key = `${type}:${date}`
      if (!seen.has(key)) { seen.add(key); output.push({ type, date }) }
    } else if (type === "knowledge-doc") {
      const slug = string(item?.slug)?.replace(/^\/+|\/+$/g, "")
      if (!slug || slug.includes("..") || slug.length > 500) continue
      const key = `${type}:${slug}`
      if (!seen.has(key)) { seen.add(key); output.push({ type, slug }) }
    }
  }
  return output
}
