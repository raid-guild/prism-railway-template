import { NextResponse } from "next/server";

import { requireCapabilityAccess } from "@/lib/admin-auth";
import { fetchPrismMemoryJson } from "@/lib/prism-memory";

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function slugFromEntry(entry: Record<string, unknown>) {
  const explicit = text(entry.slug);
  if (explicit) return explicit;
  const path = text(entry.path);
  const marker = "knowledge/kb/docs/";
  const index = path?.indexOf(marker) ?? -1;
  return index >= 0 && path
    ? path.slice(index + marker.length).replace(/\.md$/i, "")
    : null;
}

function audienceAllowed(
  audience: string | null,
  capabilities: readonly string[],
) {
  if (
    !["admin", "administrator", "operator", "internal", "restricted"].includes(
      audience?.toLowerCase() ?? "workspace",
    )
  )
    return true;
  return (
    capabilities.includes("canRunAgent") ||
    capabilities.includes("canManageMemorySources")
  );
}

function normalizedSource(value: unknown) {
  return (
    text(value)
      ?.toLowerCase()
      .replace(/\.git$/, "") ?? null
  );
}

function sourceMatches(
  entry: Record<string, unknown>,
  sourceId: string,
  sourceRepo: string | null,
) {
  const metadata = record(entry.metadata);
  const entryId = text(
    entry.source_id ??
      entry.sourceId ??
      metadata.source_id ??
      metadata.sourceId,
  );
  if (entryId === sourceId) return true;
  const entryRepo = normalizedSource(
    entry.source_repo ??
      entry.sourceRepo ??
      metadata.source_repo ??
      metadata.sourceRepo,
  );
  return Boolean(
    sourceRepo &&
      entryRepo &&
      (entryRepo === sourceRepo || entryRepo.endsWith(`/${sourceRepo}`)),
  );
}

export async function GET(request: Request) {
  const access = await requireCapabilityAccess("canViewMemory");
  if (!access.ok)
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const kind = url.searchParams.get("kind")?.trim() ?? "";
  const tag = url.searchParams.get("tag")?.trim() ?? "";
  const entity = url.searchParams.get("entity")?.trim() ?? "";
  const source = url.searchParams.get("source")?.trim() ?? "";
  const audience = url.searchParams.get("audience")?.trim() ?? "";
  const stability = url.searchParams.get("stability")?.trim() ?? "";
  const limit = Math.max(
    1,
    Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 100),
  );
  if (!query && !kind && !tag && !entity && !source && !audience && !stability)
    return NextResponse.json({
      query: null,
      filters: {},
      total: 0,
      results: [],
    });

  const manifestResult = await fetchPrismMemoryJson<unknown[]>(
    "/knowledge/indexes/manifest",
  );
  if (!manifestResult.ok || !Array.isArray(manifestResult.data))
    return NextResponse.json(
      { ok: false, error: manifestResult.error },
      { status: manifestResult.status },
    );
  const manifest = manifestResult.data.map(record);
  let selectedSourceRepo: string | null = null;
  if (source) {
    const sourceResult = await fetchPrismMemoryJson<{ sources?: unknown[] }>(
      "/knowledge/sources",
    );
    if (!sourceResult.ok)
      return NextResponse.json(
        { ok: false, error: sourceResult.error },
        { status: sourceResult.status },
      );
    const selectedSource = (sourceResult.data?.sources ?? [])
      .map(record)
      .find((item) => text(item.id) === source);
    if (!selectedSource)
      return NextResponse.json(
        { ok: false, error: "Knowledge source not found" },
        { status: 404 },
      );
    selectedSourceRepo = normalizedSource(
      selectedSource.repo_url ?? selectedSource.repoUrl,
    );
  }
  const bySlug = new Map(
    manifest.map((entry) => [slugFromEntry(entry), entry]),
  );
  let candidates: Record<string, unknown>[];
  if (query || kind || tag || entity) {
    const upstream = new URLSearchParams({ limit: "100" });
    if (query) upstream.set("q", query);
    if (kind) upstream.set("kind", kind);
    if (tag) upstream.set("tag", tag);
    if (entity) upstream.set("entity", entity);
    const result = await fetchPrismMemoryJson<{ results?: unknown[] }>(
      "/knowledge/search",
      upstream,
      ["q", "kind", "tag", "entity", "limit"],
    );
    if (!result.ok)
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    candidates = Array.isArray(result.data?.results)
      ? result.data.results.map(record)
      : [];
  } else {
    candidates = manifest;
  }

  const results = candidates
    .flatMap((candidate) => {
      const slug = text(candidate.slug) ?? slugFromEntry(candidate);
      const metadata = (slug ? bySlug.get(slug) : null) ?? candidate;
      const effectiveAudience = text(metadata.audience);
      const effectiveStability = text(metadata.stability);
      if (!audienceAllowed(effectiveAudience, access.capabilities)) return [];
      if (
        source &&
        !sourceMatches(
          { ...metadata, ...candidate },
          source,
          selectedSourceRepo,
        )
      )
        return [];
      if (audience && effectiveAudience !== audience) return [];
      if (stability && effectiveStability !== stability) return [];
      return [
        {
          ...metadata,
          ...candidate,
          slug,
          audience: effectiveAudience,
          stability: effectiveStability,
        },
      ];
    })
    .slice(0, limit);
  return NextResponse.json({
    query: query || null,
    filters: {
      kind: kind || null,
      tag: tag || null,
      entity: entity || null,
      source: source || null,
      audience: audience || null,
      stability: stability || null,
    },
    total: results.length,
    results,
  });
}
