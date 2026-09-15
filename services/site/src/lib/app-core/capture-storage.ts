import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";

const captureRootName = "captures";

export type CaptureChunkRecord = {
  index: number;
  filename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  uploadedAt: string;
  transcript?: CaptureTranscriptRecord | null;
};

export type CaptureTranscriptRecord = {
  status: "pending" | "completed" | "failed";
  transcriptJsonPath: string | null;
  transcriptMarkdownPath: string | null;
  generatedAt: string | null;
  chunksTranscribed: number;
  chunksSkipped: number;
  error: string | null;
};

export type CaptureSummaryRecord = {
  status: "pending" | "completed" | "failed";
  summaryJsonPath: string | null;
  summaryMarkdownPath: string | null;
  memoryPath?: string | null;
  memoryArtifactUrl?: string | null;
  generatedAt: string | null;
  error: string | null;
};

export type CaptureRecapRecord = {
  status: "pending" | "completed" | "failed";
  recapJsonPath: string | null;
  recapMarkdownPath: string | null;
  generatedAt: string | null;
  transcriptGeneratedAt: string | null;
  transcriptChunks: number;
  error: string | null;
};

export type CaptureDispatchRecord = {
  status: "pending" | "completed" | "failed";
  destinationType: "prism-hook" | "external-http";
  destination: string;
  dispatchedAt: string | null;
  result: unknown;
  error: string | null;
};

export type CaptureManifest = {
  id: string;
  title: string;
  status: "recording" | "finalized";
  source: "browser-capture";
  audioOnly: boolean;
  requestId: string | null;
  sourcePlatform: string | null;
  notes: string | null;
  mimeType: string | null;
  audioBitsPerSecond: number | null;
  chunkSeconds: number | null;
  startedAt: string;
  finalizedAt: string | null;
  chunks: CaptureChunkRecord[];
  transcript: CaptureTranscriptRecord | null;
  summary: CaptureSummaryRecord | null;
  recap: CaptureRecapRecord | null;
  dispatch: CaptureDispatchRecord | null;
  updatedAt: string;
};

function sanitizeFilename(value: string) {
  const candidate = value
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return candidate || "capture";
}

function sanitizeChunkExtension(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mp4")) return "m4a";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  return "webm";
}

function normalizePositiveInteger(value: number | null | undefined, max: number) {
  if (!Number.isFinite(value)) return null;
  const normalized = Math.trunc(value as number);
  if (normalized <= 0) return null;
  return Math.min(normalized, max);
}

export function captureStorageRoot() {
  return path.resolve(loadConfig().dataRoot, captureRootName);
}

export function captureSessionStoragePath(captureId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(captureId)) {
    throw new Error("INVALID_CAPTURE_ID");
  }
  return path.join("sessions", captureId);
}

export function resolveCaptureStoragePath(storagePath: string) {
  const root = captureStorageRoot();
  const resolved = path.resolve(root, storagePath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("CAPTURE_PATH_OUTSIDE_ROOT");
  }

  return resolved;
}

function manifestStoragePath(captureId: string) {
  return path.join(captureSessionStoragePath(captureId), "capture-manifest.json");
}

export function captureTranscriptStoragePaths(captureId: string) {
  return {
    json: path.join(captureSessionStoragePath(captureId), "transcripts", "transcript.json"),
    markdown: path.join(captureSessionStoragePath(captureId), "transcripts", "transcript.md"),
  };
}

export function captureChunkTranscriptStoragePaths(captureId: string, chunkIndex: number) {
  const basename = String(chunkIndex).padStart(6, "0");
  return {
    json: path.join(captureSessionStoragePath(captureId), "transcripts", "chunks", `${basename}.json`),
    markdown: path.join(captureSessionStoragePath(captureId), "transcripts", "chunks", `${basename}.md`),
  };
}

export function captureSummaryStoragePaths(captureId: string) {
  return {
    json: path.join(captureSessionStoragePath(captureId), "summaries", "summary.json"),
    markdown: path.join(captureSessionStoragePath(captureId), "summaries", "summary.md"),
  };
}

export function captureRecapStoragePaths(captureId: string) {
  return {
    json: path.join(captureSessionStoragePath(captureId), "recaps", "latest.json"),
    markdown: path.join(captureSessionStoragePath(captureId), "recaps", "latest.md"),
  };
}

export async function getCaptureManifest(captureId: string) {
  try {
    const content = await fs.readFile(resolveCaptureStoragePath(manifestStoragePath(captureId)), "utf8");
    const parsed = JSON.parse(content) as CaptureManifest;
    return parsed?.id === captureId
      ? {
          ...parsed,
          summary: parsed.summary ?? null,
          recap: parsed.recap ?? null,
          dispatch: parsed.dispatch ?? null,
          transcript: parsed.transcript ?? null,
          chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
        }
      : null;
  } catch {
    return null;
  }
}

export async function listCaptureManifests(limit = 50) {
  const root = resolveCaptureStoragePath("sessions");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => getCaptureManifest(entry.name)),
  );
  return manifests
    .filter((manifest): manifest is CaptureManifest => Boolean(manifest))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, Math.max(1, Math.min(Math.trunc(limit), 200)));
}

export async function writeCaptureManifest(manifest: CaptureManifest) {
  const resolved = resolveCaptureStoragePath(manifestStoragePath(manifest.id));
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function createCaptureSession(input: {
  title?: string | null;
  requestId?: string | null;
  sourcePlatform?: string | null;
  notes?: string | null;
  mimeType?: string | null;
  audioBitsPerSecond?: number | null;
  chunkSeconds?: number | null;
}) {
  const now = new Date().toISOString();
  const id = randomUUID();
  const manifest: CaptureManifest = {
    id,
    title: input.title?.trim() || `Browser capture ${now}`,
    status: "recording",
    source: "browser-capture",
    audioOnly: true,
    requestId: input.requestId?.trim() || null,
    sourcePlatform: input.sourcePlatform?.trim() || null,
    notes: input.notes?.trim() || null,
    mimeType: input.mimeType?.trim() || null,
    audioBitsPerSecond: normalizePositiveInteger(input.audioBitsPerSecond, 320000),
    chunkSeconds: normalizePositiveInteger(input.chunkSeconds, 600),
    startedAt: now,
    finalizedAt: null,
    chunks: [],
    transcript: null,
    summary: null,
    recap: null,
    dispatch: null,
    updatedAt: now,
  };
  await writeCaptureManifest(manifest);
  return manifest;
}

export async function writeCaptureChunk(input: {
  captureId: string;
  index: number;
  content: Buffer;
  mimeType: string;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  if (manifest.status !== "recording") {
    throw new Error("CAPTURE_NOT_RECORDING");
  }

  const extension = sanitizeChunkExtension(input.mimeType);
  const filename = `${String(input.index).padStart(6, "0")}-${sanitizeFilename(manifest.title)}.${extension}`;
  const storagePath = path.join(captureSessionStoragePath(input.captureId), "chunks", filename);
  const resolved = resolveCaptureStoragePath(storagePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, input.content);

  const now = new Date().toISOString();
  const chunk: CaptureChunkRecord = {
    index: input.index,
    filename,
    storagePath,
    mimeType: input.mimeType,
    sizeBytes: input.content.byteLength,
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    durationMs: Number.isFinite(input.durationMs) ? Math.trunc(input.durationMs as number) : null,
    uploadedAt: now,
    transcript: null,
  };
  const chunks = manifest.chunks.filter((existing) => existing.index !== input.index);
  chunks.push(chunk);
  chunks.sort((left, right) => left.index - right.index);
  const updated = {
    ...manifest,
    mimeType: manifest.mimeType ?? input.mimeType,
    chunks,
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return { manifest: updated, chunk };
}

export async function finalizeCaptureSession(input: {
  captureId: string;
  notes?: string | null;
  requestId?: string | null;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    status: "finalized",
    notes: input.notes?.trim() || manifest.notes,
    requestId: input.requestId?.trim() || manifest.requestId,
    finalizedAt: manifest.finalizedAt ?? now,
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function markCaptureTranscriptPending(captureId: string) {
  const manifest = await getCaptureManifest(captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    transcript: {
      status: "pending",
      transcriptJsonPath: null,
      transcriptMarkdownPath: null,
      generatedAt: null,
      chunksTranscribed: 0,
      chunksSkipped: 0,
      error: null,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function markCaptureSummaryPending(captureId: string) {
  const manifest = await getCaptureManifest(captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    summary: {
      status: "pending",
      summaryJsonPath: null,
      summaryMarkdownPath: null,
      generatedAt: null,
      error: null,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function markCaptureRecapPending(captureId: string) {
  const manifest = await getCaptureManifest(captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    recap: {
      status: "pending",
      recapJsonPath: null,
      recapMarkdownPath: null,
      generatedAt: null,
      transcriptGeneratedAt: null,
      transcriptChunks: 0,
      error: null,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function updateCaptureChunkTranscript(input: {
  captureId: string;
  chunkIndex: number;
  transcript: CaptureTranscriptRecord;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const chunks = manifest.chunks.map((chunk) => chunk.index === input.chunkIndex
    ? { ...chunk, transcript: input.transcript }
    : chunk);
  if (!chunks.some((chunk) => chunk.index === input.chunkIndex)) {
    throw new Error("CAPTURE_CHUNK_NOT_FOUND");
  }
  const updated: CaptureManifest = {
    ...manifest,
    chunks,
    updatedAt: new Date().toISOString(),
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function readCaptureTranscriptFiles(captureId: string) {
  const manifest = await getCaptureManifest(captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const jsonPath = manifest.transcript?.transcriptJsonPath;
  const markdownPath = manifest.transcript?.transcriptMarkdownPath;
  if (!jsonPath || !markdownPath || manifest.transcript?.status !== "completed") {
    throw new Error("CAPTURE_TRANSCRIPT_NOT_READY");
  }
  const [jsonContent, markdownContent] = await Promise.all([
    fs.readFile(resolveCaptureStoragePath(jsonPath), "utf8"),
    fs.readFile(resolveCaptureStoragePath(markdownPath), "utf8"),
  ]);
  return {
    manifest,
    json: JSON.parse(jsonContent) as unknown,
    markdown: markdownContent,
  };
}

export async function readCaptureTranscriptFile(captureId: string, format: "markdown" | "json") {
  const transcript = await readCaptureTranscriptFiles(captureId);
  return {
    manifest: transcript.manifest,
    content: format === "json"
      ? Buffer.from(`${JSON.stringify(transcript.json, null, 2)}\n`, "utf8")
      : Buffer.from(transcript.markdown, "utf8"),
    mimeType: format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
    filename: format === "json" ? "transcript.json" : "transcript.md",
  };
}

export async function readCaptureSummaryFiles(captureId: string) {
  const manifest = await getCaptureManifest(captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const jsonPath = manifest.summary?.summaryJsonPath;
  const markdownPath = manifest.summary?.summaryMarkdownPath;
  if (!jsonPath || !markdownPath || manifest.summary?.status !== "completed") {
    throw new Error("CAPTURE_SUMMARY_NOT_READY");
  }
  const [jsonContent, markdownContent] = await Promise.all([
    fs.readFile(resolveCaptureStoragePath(jsonPath), "utf8"),
    fs.readFile(resolveCaptureStoragePath(markdownPath), "utf8"),
  ]);
  return {
    manifest,
    json: JSON.parse(jsonContent) as unknown,
    markdown: markdownContent,
  };
}

export async function readCaptureSummaryFile(captureId: string, format: "markdown" | "json") {
  const summary = await readCaptureSummaryFiles(captureId);
  return {
    manifest: summary.manifest,
    content: format === "json"
      ? Buffer.from(`${JSON.stringify(summary.json, null, 2)}\n`, "utf8")
      : Buffer.from(summary.markdown, "utf8"),
    mimeType: format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
    filename: format === "json" ? "summary.json" : "summary.md",
  };
}

export async function readCaptureRecapFiles(captureId: string) {
  const manifest = await getCaptureManifest(captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const jsonPath = manifest.recap?.recapJsonPath;
  const markdownPath = manifest.recap?.recapMarkdownPath;
  if (!jsonPath || !markdownPath || manifest.recap?.status !== "completed") {
    throw new Error("CAPTURE_RECAP_NOT_READY");
  }
  const [jsonContent, markdownContent] = await Promise.all([
    fs.readFile(resolveCaptureStoragePath(jsonPath), "utf8"),
    fs.readFile(resolveCaptureStoragePath(markdownPath), "utf8"),
  ]);
  return {
    manifest,
    json: JSON.parse(jsonContent) as unknown,
    markdown: markdownContent,
  };
}

export async function readCaptureRecapFile(captureId: string, format: "markdown" | "json") {
  const recap = await readCaptureRecapFiles(captureId);
  return {
    manifest: recap.manifest,
    content: format === "json"
      ? Buffer.from(`${JSON.stringify(recap.json, null, 2)}\n`, "utf8")
      : Buffer.from(recap.markdown, "utf8"),
    mimeType: format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
    filename: format === "json" ? "recap.json" : "recap.md",
  };
}

export async function writeCaptureTranscriptFiles(input: {
  captureId: string;
  jsonContent: string;
  markdownContent: string;
  chunksTranscribed: number;
  chunksSkipped: number;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }

  const paths = captureTranscriptStoragePaths(input.captureId);
  const resolvedJson = resolveCaptureStoragePath(paths.json);
  const resolvedMarkdown = resolveCaptureStoragePath(paths.markdown);
  await fs.mkdir(path.dirname(resolvedJson), { recursive: true });
  await fs.writeFile(resolvedJson, input.jsonContent.endsWith("\n") ? input.jsonContent : `${input.jsonContent}\n`, "utf8");
  await fs.writeFile(
    resolvedMarkdown,
    input.markdownContent.endsWith("\n") ? input.markdownContent : `${input.markdownContent}\n`,
    "utf8",
  );

  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    transcript: {
      status: "completed",
      transcriptJsonPath: paths.json,
      transcriptMarkdownPath: paths.markdown,
      generatedAt: now,
      chunksTranscribed: Math.max(0, Math.trunc(input.chunksTranscribed)),
      chunksSkipped: Math.max(0, Math.trunc(input.chunksSkipped)),
      error: null,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function writeCaptureSummaryFiles(input: {
  captureId: string;
  jsonContent: string;
  markdownContent: string;
  memoryPath?: string | null;
  memoryArtifactUrl?: string | null;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }

  const paths = captureSummaryStoragePaths(input.captureId);
  const resolvedJson = resolveCaptureStoragePath(paths.json);
  const resolvedMarkdown = resolveCaptureStoragePath(paths.markdown);
  await fs.mkdir(path.dirname(resolvedJson), { recursive: true });
  await fs.writeFile(resolvedJson, input.jsonContent.endsWith("\n") ? input.jsonContent : `${input.jsonContent}\n`, "utf8");
  await fs.writeFile(
    resolvedMarkdown,
    input.markdownContent.endsWith("\n") ? input.markdownContent : `${input.markdownContent}\n`,
    "utf8",
  );

  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    summary: {
      status: "completed",
      summaryJsonPath: paths.json,
      summaryMarkdownPath: paths.markdown,
      memoryPath: input.memoryPath ?? manifest.summary?.memoryPath ?? null,
      memoryArtifactUrl: input.memoryArtifactUrl ?? manifest.summary?.memoryArtifactUrl ?? null,
      generatedAt: now,
      error: null,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function updateCaptureSummaryMemory(input: {
  captureId: string;
  memoryPath: string | null;
  memoryArtifactUrl: string | null;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  if (!manifest.summary) {
    throw new Error("CAPTURE_SUMMARY_NOT_READY");
  }
  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    summary: {
      ...manifest.summary,
      memoryPath: input.memoryPath,
      memoryArtifactUrl: input.memoryArtifactUrl,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function writeCaptureRecapFiles(input: {
  captureId: string;
  jsonContent: string;
  markdownContent: string;
  transcriptGeneratedAt: string | null;
  transcriptChunks: number;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }

  const paths = captureRecapStoragePaths(input.captureId);
  const resolvedJson = resolveCaptureStoragePath(paths.json);
  const resolvedMarkdown = resolveCaptureStoragePath(paths.markdown);
  await fs.mkdir(path.dirname(resolvedJson), { recursive: true });
  await fs.writeFile(resolvedJson, input.jsonContent.endsWith("\n") ? input.jsonContent : `${input.jsonContent}\n`, "utf8");
  await fs.writeFile(
    resolvedMarkdown,
    input.markdownContent.endsWith("\n") ? input.markdownContent : `${input.markdownContent}\n`,
    "utf8",
  );

  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    recap: {
      status: "completed",
      recapJsonPath: paths.json,
      recapMarkdownPath: paths.markdown,
      generatedAt: now,
      transcriptGeneratedAt: input.transcriptGeneratedAt,
      transcriptChunks: Math.max(0, Math.trunc(input.transcriptChunks)),
      error: null,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function writeCaptureChunkTranscriptFiles(input: {
  captureId: string;
  chunkIndex: number;
  jsonContent: string;
  markdownContent: string;
}) {
  const paths = captureChunkTranscriptStoragePaths(input.captureId, input.chunkIndex);
  const resolvedJson = resolveCaptureStoragePath(paths.json);
  const resolvedMarkdown = resolveCaptureStoragePath(paths.markdown);
  await fs.mkdir(path.dirname(resolvedJson), { recursive: true });
  await fs.writeFile(resolvedJson, input.jsonContent.endsWith("\n") ? input.jsonContent : `${input.jsonContent}\n`, "utf8");
  await fs.writeFile(
    resolvedMarkdown,
    input.markdownContent.endsWith("\n") ? input.markdownContent : `${input.markdownContent}\n`,
    "utf8",
  );
  return paths;
}

export async function markCaptureTranscriptFailed(input: {
  captureId: string;
  error: string;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    transcript: {
      status: "failed",
      transcriptJsonPath: manifest.transcript?.transcriptJsonPath ?? null,
      transcriptMarkdownPath: manifest.transcript?.transcriptMarkdownPath ?? null,
      generatedAt: manifest.transcript?.generatedAt ?? null,
      chunksTranscribed: manifest.transcript?.chunksTranscribed ?? 0,
      chunksSkipped: manifest.transcript?.chunksSkipped ?? 0,
      error: input.error,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function markCaptureSummaryFailed(input: {
  captureId: string;
  error: string;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    summary: {
      status: "failed",
      summaryJsonPath: manifest.summary?.summaryJsonPath ?? null,
      summaryMarkdownPath: manifest.summary?.summaryMarkdownPath ?? null,
      generatedAt: manifest.summary?.generatedAt ?? null,
      error: input.error,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function markCaptureRecapFailed(input: {
  captureId: string;
  error: string;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    recap: {
      status: "failed",
      recapJsonPath: manifest.recap?.recapJsonPath ?? null,
      recapMarkdownPath: manifest.recap?.recapMarkdownPath ?? null,
      generatedAt: manifest.recap?.generatedAt ?? null,
      transcriptGeneratedAt: manifest.recap?.transcriptGeneratedAt ?? null,
      transcriptChunks: manifest.recap?.transcriptChunks ?? 0,
      error: input.error,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function markCaptureDispatchPending(input: {
  captureId: string;
  destinationType: CaptureDispatchRecord["destinationType"];
  destination: string;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    dispatch: {
      status: "pending",
      destinationType: input.destinationType,
      destination: input.destination,
      dispatchedAt: null,
      result: null,
      error: null,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function markCaptureDispatchCompleted(input: {
  captureId: string;
  destinationType: CaptureDispatchRecord["destinationType"];
  destination: string;
  result: unknown;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    dispatch: {
      status: "completed",
      destinationType: input.destinationType,
      destination: input.destination,
      dispatchedAt: now,
      result: input.result,
      error: null,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}

export async function markCaptureDispatchFailed(input: {
  captureId: string;
  destinationType: CaptureDispatchRecord["destinationType"];
  destination: string;
  error: string;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const now = new Date().toISOString();
  const updated: CaptureManifest = {
    ...manifest,
    dispatch: {
      status: "failed",
      destinationType: input.destinationType,
      destination: input.destination,
      dispatchedAt: manifest.dispatch?.dispatchedAt ?? null,
      result: manifest.dispatch?.result ?? null,
      error: input.error,
    },
    updatedAt: now,
  };
  await writeCaptureManifest(updated);
  return updated;
}
