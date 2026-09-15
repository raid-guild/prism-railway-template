import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getCaptureManifest,
  markCaptureTranscriptFailed,
  markCaptureTranscriptPending,
  resolveCaptureStoragePath,
  updateCaptureChunkTranscript,
  writeCaptureChunkTranscriptFiles,
  writeCaptureTranscriptFiles,
  type CaptureChunkRecord,
} from "./capture-storage";

const minTranscribableAudioBytes = 1024;

type TranscriptionTimestampSegment = {
  text?: unknown;
  start?: unknown;
  end?: unknown;
};

type TranscriptionResponse = {
  text?: unknown;
  duration?: unknown;
  timestamps?: {
    segment?: TranscriptionTimestampSegment[];
  };
};

type CaptureTranscriptSegment = {
  text: string;
  start: number;
  end: number;
  chunkIndex: number;
  source: "browser-capture";
};

type CaptureTranscriptChunk = {
  index: number;
  filename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  startedAt: string | null;
  endedAt: string | null;
  status: "transcribed" | "skipped";
  text: string;
  segments: CaptureTranscriptSegment[];
  reason: string | null;
};

type TranscriptionInput = {
  filename: string;
  mimeType: string;
  content: Buffer;
};

function transcriptionApiKey() {
  return (
    process.env.VOICE_TRANSCRIPTION_API_KEY?.trim()
    || process.env.VENICE_API_KEY?.trim()
    || ""
  );
}

function transcriptionApiUrl() {
  return (
    process.env.VOICE_TRANSCRIPTION_BASE_URL?.trim().replace(/\/+$/, "")
    || process.env.VENICE_TRANSCRIPTION_BASE_URL?.trim().replace(/\/+$/, "")
    || ""
  );
}

function transcriptionModel() {
  return process.env.VOICE_TRANSCRIPTION_MODEL?.trim() || process.env.VENICE_TRANSCRIPTION_MODEL?.trim() || "";
}

function maxUploadBytes() {
  const rawMb = Number.parseInt(process.env.VOICE_TRANSCRIPTION_MAX_UPLOAD_MB ?? "25", 10);
  const safeMb = Number.isFinite(rawMb) ? Math.max(1, Math.min(rawMb, 500)) : 25;
  return safeMb * 1024 * 1024;
}

function formatTimeSec(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}

function parseNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function chunkOffsetSeconds(chunk: CaptureChunkRecord, captureStartedAt: string, fallbackOffsetSeconds: number) {
  if (!chunk.startedAt) return fallbackOffsetSeconds;
  const captureStart = Date.parse(captureStartedAt);
  const chunkStart = Date.parse(chunk.startedAt);
  if (!Number.isFinite(captureStart) || !Number.isFinite(chunkStart)) return fallbackOffsetSeconds;
  return Math.max(0, (chunkStart - captureStart) / 1000);
}

function normalizeSegments(input: {
  chunk: CaptureChunkRecord;
  response: TranscriptionResponse;
  offsetSeconds: number;
}) {
  const rawSegments = Array.isArray(input.response.timestamps?.segment)
    ? input.response.timestamps?.segment ?? []
    : [];
  const segments = rawSegments
    .map((segment) => ({
      text: String(segment.text ?? "").trim(),
      start: parseNumber(segment.start) + input.offsetSeconds,
      end: parseNumber(segment.end) + input.offsetSeconds,
      chunkIndex: input.chunk.index,
      source: "browser-capture" as const,
    }))
    .filter((segment) => segment.text);

  if (segments.length > 0) {
    return segments;
  }

  const fallbackText = String(input.response.text ?? "").trim();
  if (!fallbackText) {
    return [];
  }

  const durationSeconds = input.chunk.durationMs
    ? Math.max(1, Math.round(input.chunk.durationMs / 1000))
    : Math.max(1, parseNumber(input.response.duration, 1));
  return [
    {
      text: fallbackText,
      start: input.offsetSeconds,
      end: input.offsetSeconds + durationSeconds,
      chunkIndex: input.chunk.index,
      source: "browser-capture" as const,
    },
  ];
}

async function transcribeAudio(input: TranscriptionInput) {
  const apiKey = transcriptionApiKey();
  const apiUrl = transcriptionApiUrl();
  if (!apiKey || !apiUrl) {
    throw new Error("CAPTURE_TRANSCRIPTION_NOT_CONFIGURED");
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(input.content)], { type: input.mimeType || "audio/webm" }), input.filename);
  const model = transcriptionModel();
  if (model) {
    form.append("model", model);
  }
  form.append("response_format", process.env.VOICE_TRANSCRIPTION_RESPONSE_FORMAT?.trim() || "json");
  form.append("timestamps", process.env.VOICE_TRANSCRIPTION_TIMESTAMPS?.trim() || "true");
  const language = process.env.VOICE_TRANSCRIPTION_LANGUAGE?.trim();
  if (language) {
    form.append("language", language);
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`CAPTURE_TRANSCRIPTION_FAILED:${response.status}:${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as TranscriptionResponse;
}

async function readChunkContent(chunk: CaptureChunkRecord) {
  const resolved = resolveCaptureStoragePath(chunk.storagePath);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat) {
    return { resolved, stat: null, content: null };
  }
  if (stat.size < minTranscribableAudioBytes || stat.size > maxUploadBytes()) {
    return { resolved, stat, content: null };
  }
  return { resolved, stat, content: await fs.readFile(resolved) };
}

function buildMarkdown(input: {
  title: string;
  captureId: string;
  startedAt: string;
  finalizedAt: string | null;
  generatedAt: string;
  chunks: CaptureTranscriptChunk[];
  segments: CaptureTranscriptSegment[];
}) {
  const skipped = input.chunks.filter((chunk) => chunk.status === "skipped");
  return [
    `# ${input.title || "Browser Capture Transcript"}`,
    "",
    `- Capture: \`${input.captureId}\``,
    `- Started: ${input.startedAt}`,
    input.finalizedAt ? `- Finalized: ${input.finalizedAt}` : null,
    `- Generated: ${input.generatedAt}`,
    `- Chunks: ${input.chunks.length}`,
    "",
    "## Transcript",
    "",
    input.segments.length
      ? input.segments.map((segment) => `[${formatTimeSec(segment.start)}] ${segment.text}`).join("\n")
      : "_No transcript text returned._",
    "",
    skipped.length
      ? [
          "## Skipped Chunks",
          "",
          ...skipped.map((chunk) => `- Chunk ${chunk.index + 1} (${chunk.filename}): ${chunk.reason ?? "skipped"}`),
          "",
        ].join("\n")
      : null,
  ].filter((line): line is string => typeof line === "string").join("\n");
}

function buildChunkMarkdown(input: {
  title: string;
  captureId: string;
  chunk: CaptureTranscriptChunk;
  generatedAt: string;
}) {
  return [
    `# ${input.title || "Browser Capture"} - Chunk ${input.chunk.index + 1}`,
    "",
    `- Capture: \`${input.captureId}\``,
    `- Chunk: ${input.chunk.index}`,
    `- Generated: ${input.generatedAt}`,
    input.chunk.startedAt ? `- Started: ${input.chunk.startedAt}` : null,
    input.chunk.endedAt ? `- Ended: ${input.chunk.endedAt}` : null,
    "",
    "## Transcript",
    "",
    input.chunk.segments.length
      ? input.chunk.segments.map((segment) => `[${formatTimeSec(segment.start)}] ${segment.text}`).join("\n")
      : "_No transcript text returned._",
  ].filter((line): line is string => typeof line === "string").join("\n");
}

function transcriptPayloadFromChunks(input: {
  captureId: string;
  title: string;
  source: string;
  startedAt: string;
  finalizedAt: string | null;
  generatedAt: string;
  chunks: CaptureTranscriptChunk[];
}) {
  const segments = input.chunks.flatMap((chunk) => chunk.segments).sort((left, right) => left.start - right.start);
  return {
    captureId: input.captureId,
    title: input.title,
    source: input.source,
    startedAt: input.startedAt,
    finalizedAt: input.finalizedAt,
    generatedAt: input.generatedAt,
    chunks: input.chunks,
    segments,
    transcript: segments.map((segment) => `[${formatTimeSec(segment.start)}] ${segment.text}`).join("\n"),
  };
}

async function readCompletedChunkTranscript(captureId: string, chunk: CaptureChunkRecord) {
  if (chunk.transcript?.status !== "completed" || !chunk.transcript.transcriptJsonPath) {
    return null;
  }
  const content = await fs.readFile(resolveCaptureStoragePath(chunk.transcript.transcriptJsonPath), "utf8").catch(() => null);
  if (!content) return null;
  const parsed = JSON.parse(content) as { chunk?: CaptureTranscriptChunk };
  return parsed.chunk ?? null;
}

async function chunkLooksStandaloneWebm(chunk: CaptureChunkRecord) {
  if (!chunk.mimeType.toLowerCase().includes("webm")) return true;
  const resolved = resolveCaptureStoragePath(chunk.storagePath);
  const handle = await fs.open(resolved, "r").catch(() => null);
  if (!handle) return false;
  try {
    const header = Buffer.alloc(4);
    await handle.read(header, 0, 4, 0);
    return header.toString("hex") === "1a45dfa3";
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function rebuildAggregateFromCompletedChunks(input: {
  captureId: string;
  generatedAt: string;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const completedChunks = (await Promise.all(
    manifest.chunks.map((candidate) => readCompletedChunkTranscript(input.captureId, candidate)),
  )).filter((candidate): candidate is CaptureTranscriptChunk => Boolean(candidate));
  if (completedChunks.length === 0) return null;

  const aggregate = transcriptPayloadFromChunks({
    captureId: manifest.id,
    title: manifest.title,
    source: manifest.source,
    startedAt: manifest.startedAt,
    finalizedAt: manifest.finalizedAt,
    generatedAt: input.generatedAt,
    chunks: completedChunks.sort((left, right) => left.index - right.index),
  });
  const completed = await writeCaptureTranscriptFiles({
    captureId: input.captureId,
    jsonContent: JSON.stringify(aggregate, null, 2),
    markdownContent: buildMarkdown({
      title: manifest.title,
      captureId: manifest.id,
      startedAt: manifest.startedAt,
      finalizedAt: manifest.finalizedAt,
      generatedAt: input.generatedAt,
      chunks: aggregate.chunks,
      segments: aggregate.segments,
    }),
    chunksTranscribed: completedChunks.length,
    chunksSkipped: Math.max(0, manifest.chunks.length - completedChunks.length),
  });
  return { manifest: completed, transcript: aggregate };
}

export async function transcribeCaptureChunk(captureId: string, chunkIndex: number) {
  const manifest = await getCaptureManifest(captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  const chunk = manifest.chunks.find((candidate) => candidate.index === chunkIndex);
  if (!chunk) {
    throw new Error("CAPTURE_CHUNK_NOT_FOUND");
  }
  if (!transcriptionApiKey() || !transcriptionApiUrl()) {
    throw new Error("CAPTURE_TRANSCRIPTION_NOT_CONFIGURED");
  }

  await updateCaptureChunkTranscript({
    captureId,
    chunkIndex,
    transcript: {
      status: "pending",
      transcriptJsonPath: null,
      transcriptMarkdownPath: null,
      generatedAt: null,
      chunksTranscribed: 0,
      chunksSkipped: 0,
      error: null,
    },
  });

  const generatedAt = new Date().toISOString();
  try {
    const resolved = resolveCaptureStoragePath(chunk.storagePath);
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat || stat.size < minTranscribableAudioBytes) {
      throw new Error(stat ? `CAPTURE_CHUNK_TOO_SMALL:${stat.size}` : "CAPTURE_CHUNK_MISSING");
    }
    if (stat.size > maxUploadBytes()) {
      throw new Error(`CAPTURE_CHUNK_EXCEEDS_UPLOAD_LIMIT:${stat.size}`);
    }

    const response = await transcribeAudio({
      filename: path.basename(resolved),
      mimeType: chunk.mimeType || "audio/webm",
      content: await fs.readFile(resolved),
    });
    const offsetSeconds = chunkOffsetSeconds(chunk, manifest.startedAt, 0);
    const segments = normalizeSegments({ chunk, response, offsetSeconds });
    const transcriptChunk: CaptureTranscriptChunk = {
      index: chunk.index,
      filename: chunk.filename,
      storagePath: chunk.storagePath,
      mimeType: chunk.mimeType,
      sizeBytes: stat.size,
      durationMs: chunk.durationMs,
      startedAt: chunk.startedAt,
      endedAt: chunk.endedAt,
      status: "transcribed",
      text: segments.map((segment) => segment.text).join(" ").trim(),
      segments,
      reason: null,
    };
    const chunkPayload = {
      captureId: manifest.id,
      generatedAt,
      chunk: transcriptChunk,
    };
    const paths = await writeCaptureChunkTranscriptFiles({
      captureId,
      chunkIndex,
      jsonContent: JSON.stringify(chunkPayload, null, 2),
      markdownContent: buildChunkMarkdown({
        title: manifest.title,
        captureId: manifest.id,
        chunk: transcriptChunk,
        generatedAt,
      }),
    });
    const withChunk = await updateCaptureChunkTranscript({
      captureId,
      chunkIndex,
      transcript: {
        status: "completed",
        transcriptJsonPath: paths.json,
        transcriptMarkdownPath: paths.markdown,
        generatedAt,
        chunksTranscribed: 1,
        chunksSkipped: 0,
        error: null,
      },
    });
    const completedChunks = (await Promise.all(
      withChunk.chunks.map((candidate) => readCompletedChunkTranscript(captureId, candidate)),
    )).filter((candidate): candidate is CaptureTranscriptChunk => Boolean(candidate));
    const aggregate = transcriptPayloadFromChunks({
      captureId: manifest.id,
      title: manifest.title,
      source: manifest.source,
      startedAt: manifest.startedAt,
      finalizedAt: manifest.finalizedAt,
      generatedAt,
      chunks: completedChunks.sort((left, right) => left.index - right.index),
    });
    const completed = await writeCaptureTranscriptFiles({
      captureId,
      jsonContent: JSON.stringify(aggregate, null, 2),
      markdownContent: buildMarkdown({
        title: manifest.title,
        captureId: manifest.id,
        startedAt: manifest.startedAt,
        finalizedAt: manifest.finalizedAt,
        generatedAt,
        chunks: aggregate.chunks,
        segments: aggregate.segments,
      }),
      chunksTranscribed: completedChunks.length,
      chunksSkipped: Math.max(0, withChunk.chunks.length - completedChunks.length),
    });
    return { manifest: completed, transcript: aggregate, chunk: transcriptChunk };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_CHUNK_TRANSCRIPTION_FAILED";
    await updateCaptureChunkTranscript({
      captureId,
      chunkIndex,
      transcript: {
        status: "failed",
        transcriptJsonPath: null,
        transcriptMarkdownPath: null,
        generatedAt: null,
        chunksTranscribed: 0,
        chunksSkipped: 1,
        error: message,
      },
    }).catch(() => undefined);
    throw error;
  }
}

export async function transcribeCaptureSession(captureId: string) {
  const manifest = await getCaptureManifest(captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  if (manifest.status !== "finalized") {
    throw new Error("CAPTURE_NOT_FINALIZED");
  }
  if (manifest.chunks.length === 0) {
    throw new Error("CAPTURE_HAS_NO_CHUNKS");
  }
  if (!transcriptionApiKey() || !transcriptionApiUrl()) {
    throw new Error("CAPTURE_TRANSCRIPTION_NOT_CONFIGURED");
  }

  await markCaptureTranscriptPending(captureId);
  const generatedAt = new Date().toISOString();
  const chunks: CaptureTranscriptChunk[] = [];
  const allSegments: CaptureTranscriptSegment[] = [];
  let fallbackOffsetSeconds = 0;

  try {
    const aggregateFromChunks = await rebuildAggregateFromCompletedChunks({ captureId, generatedAt });
    if (aggregateFromChunks && aggregateFromChunks.transcript.chunks.length === manifest.chunks.length) {
      return aggregateFromChunks;
    }

    if (manifest.chunks.length > 1) {
      const standalone = await Promise.all(manifest.chunks.map((chunk) => chunkLooksStandaloneWebm(chunk)));
      if (standalone.every(Boolean)) {
        let latest: Awaited<ReturnType<typeof transcribeCaptureChunk>> | null = null;
        for (const chunk of manifest.chunks) {
          if (chunk.transcript?.status === "completed") continue;
          latest = await transcribeCaptureChunk(captureId, chunk.index);
        }
        const rebuilt = await rebuildAggregateFromCompletedChunks({ captureId, generatedAt });
        if (rebuilt) return rebuilt;
        if (latest) return { manifest: latest.manifest, transcript: latest.transcript };
      }
    }

    const totalBytes = manifest.chunks.reduce((sum, chunk) => sum + Math.max(0, chunk.sizeBytes), 0);
    if (manifest.chunks.length > 1 && totalBytes <= maxUploadBytes()) {
      const contents: Buffer[] = [];
      const skippedChunks: CaptureTranscriptChunk[] = [];
      for (const chunk of manifest.chunks) {
        const read = await readChunkContent(chunk);
        if (!read.stat || !read.content) {
          skippedChunks.push({
            index: chunk.index,
            filename: chunk.filename,
            storagePath: chunk.storagePath,
            mimeType: chunk.mimeType,
            sizeBytes: read.stat?.size ?? 0,
            durationMs: chunk.durationMs,
            startedAt: chunk.startedAt,
            endedAt: chunk.endedAt,
            status: "skipped",
            text: "",
            segments: [],
            reason: read.stat ? `audio chunk cannot be uploaded (${read.stat.size} bytes)` : "audio chunk missing",
          });
          continue;
        }
        contents.push(read.content);
      }

      if (contents.length > 0) {
        const assembledContent = Buffer.concat(contents);
        const syntheticChunk: CaptureChunkRecord = {
          ...manifest.chunks[0],
          filename: `${manifest.id}-assembled.webm`,
          mimeType: manifest.mimeType || manifest.chunks[0]?.mimeType || "audio/webm",
          sizeBytes: assembledContent.byteLength,
          durationMs: manifest.chunks.reduce((sum, chunk) => sum + (chunk.durationMs ?? 0), 0) || null,
          endedAt: manifest.chunks[manifest.chunks.length - 1]?.endedAt ?? manifest.chunks[0].endedAt,
        };
        const response = await transcribeAudio({
          filename: syntheticChunk.filename,
          mimeType: syntheticChunk.mimeType,
          content: assembledContent,
        });
        const segments = normalizeSegments({ chunk: syntheticChunk, response, offsetSeconds: 0 });
        const text = segments.map((segment) => segment.text).join(" ").trim();
        allSegments.push(...segments);
        chunks.push({
          index: 0,
          filename: syntheticChunk.filename,
          storagePath: manifest.chunks.map((chunk) => chunk.storagePath).join(","),
          mimeType: syntheticChunk.mimeType,
          sizeBytes: assembledContent.byteLength,
          durationMs: syntheticChunk.durationMs,
          startedAt: syntheticChunk.startedAt,
          endedAt: syntheticChunk.endedAt,
          status: "transcribed",
          text,
          segments,
          reason: null,
        });
        chunks.push(...skippedChunks);
      }
    }

    if (chunks.length === 0 && manifest.chunks.length > 1 && totalBytes > maxUploadBytes()) {
      throw new Error("CAPTURE_TRANSCRIPTION_REQUIRES_STANDALONE_CHUNKS");
    }

    for (const chunk of manifest.chunks) {
      if (chunks.length > 0) break;
      const resolved = resolveCaptureStoragePath(chunk.storagePath);
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat || stat.size < minTranscribableAudioBytes) {
        chunks.push({
          index: chunk.index,
          filename: chunk.filename,
          storagePath: chunk.storagePath,
          mimeType: chunk.mimeType,
          sizeBytes: stat?.size ?? 0,
          durationMs: chunk.durationMs,
          startedAt: chunk.startedAt,
          endedAt: chunk.endedAt,
          status: "skipped",
          text: "",
          segments: [],
          reason: stat ? `audio chunk too small (${stat.size} bytes)` : "audio chunk missing",
        });
        continue;
      }
      if (stat.size > maxUploadBytes()) {
        chunks.push({
          index: chunk.index,
          filename: chunk.filename,
          storagePath: chunk.storagePath,
          mimeType: chunk.mimeType,
          sizeBytes: stat.size,
          durationMs: chunk.durationMs,
          startedAt: chunk.startedAt,
          endedAt: chunk.endedAt,
          status: "skipped",
          text: "",
          segments: [],
          reason: `audio chunk exceeds upload limit (${stat.size} bytes)`,
        });
        continue;
      }

      const offsetSeconds = chunkOffsetSeconds(chunk, manifest.startedAt, fallbackOffsetSeconds);
      const content = await fs.readFile(resolved);
      const response = await transcribeAudio({
        filename: path.basename(resolved),
        mimeType: chunk.mimeType || "audio/webm",
        content,
      });
      const segments = normalizeSegments({ chunk, response, offsetSeconds });
      const text = segments.map((segment) => segment.text).join(" ").trim();
      allSegments.push(...segments);
      chunks.push({
        index: chunk.index,
        filename: chunk.filename,
        storagePath: chunk.storagePath,
        mimeType: chunk.mimeType,
        sizeBytes: stat.size,
        durationMs: chunk.durationMs,
        startedAt: chunk.startedAt,
        endedAt: chunk.endedAt,
        status: "transcribed",
        text,
        segments,
        reason: null,
      });
      fallbackOffsetSeconds += chunk.durationMs ? chunk.durationMs / 1000 : Math.max(0, ...segments.map((segment) => segment.end));
    }

    allSegments.sort((left, right) => left.start - right.start);
    const payload = {
      captureId: manifest.id,
      title: manifest.title,
      source: manifest.source,
      startedAt: manifest.startedAt,
      finalizedAt: manifest.finalizedAt,
      generatedAt,
      chunks,
      segments: allSegments,
      transcript: allSegments.map((segment) => `[${formatTimeSec(segment.start)}] ${segment.text}`).join("\n"),
    };
    const completed = await writeCaptureTranscriptFiles({
      captureId,
      jsonContent: JSON.stringify(payload, null, 2),
      markdownContent: buildMarkdown({
        title: manifest.title,
        captureId: manifest.id,
        startedAt: manifest.startedAt,
        finalizedAt: manifest.finalizedAt,
        generatedAt,
        chunks,
        segments: allSegments,
      }),
      chunksTranscribed: chunks.filter((chunk) => chunk.status === "transcribed").length,
      chunksSkipped: chunks.filter((chunk) => chunk.status === "skipped").length,
    });

    return { manifest: completed, transcript: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_TRANSCRIPTION_FAILED";
    await markCaptureTranscriptFailed({ captureId, error: message }).catch(() => undefined);
    throw error;
  }
}
