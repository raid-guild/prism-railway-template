import {
  getCaptureManifest,
  markCaptureSummaryFailed,
  markCaptureSummaryPending,
  readCaptureTranscriptFiles,
  updateCaptureSummaryMemory,
  writeCaptureSummaryFiles,
  type CaptureManifest,
} from "./capture-storage";
import { promoteMeetingSummaryToMemory, type MeetingMemoryPromotionResult } from "./meeting-memory";
import { readRecordingSummaryProfile } from "./recording-summary-profile";
import { requestRuntimeResponse } from "./runtime-client";

export type CaptureSummary = {
  title: string;
  tldr: string;
  summary: string;
  actionItems: Array<{
    name: string;
    description: string;
    assignedTo: string | null;
    dueDate: string | null;
    params: Record<string, string>;
  }>;
  notableQuotes: Array<{
    author: string;
    quote: string;
    paraphrase: string;
  }>;
  tags: string[];
  memory?: MeetingMemoryPromotionResult | null;
  raw?: unknown;
};

function runtimeTimeoutMs() {
  const milliseconds = Number.parseInt(process.env.CODEX_RUNTIME_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(milliseconds) && milliseconds > 0) return milliseconds;
  const seconds = Number.parseInt(process.env.CODEX_RUNTIME_REQUEST_TIMEOUT_SECONDS ?? "", 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return 660_000;
}

export async function runtimeRequest(input: {
  prompt: string;
  captureId: string;
  metadata: Record<string, unknown>;
  sessionId?: string;
}) {
  const response = await requestRuntimeResponse({
    prompt: input.prompt,
    sessionId: input.sessionId ?? `capture-summary-${input.captureId}`,
    continuationId: null,
    recentHistory: [],
    metadata: input.metadata,
    timeoutMs: runtimeTimeoutMs(),
  });
  return response.responseText;
}

export function safeJsonParse(input: string) {
  const cleaned = input
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("CAPTURE_SUMMARY_JSON_PARSE_FAILED");
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringOrNull(value: unknown) {
  const normalized = stringValue(value);
  return normalized || null;
}

function normalizeActionItems(value: unknown): CaptureSummary["actionItems"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      name: stringValue(item.name) || "Action item",
      description: stringValue(item.description),
      assignedTo: stringOrNull(item.assignedTo),
      dueDate: stringOrNull(item.dueDate),
      params: item.params && typeof item.params === "object" && !Array.isArray(item.params)
        ? Object.fromEntries(Object.entries(item.params).map(([key, value]) => [key, String(value)]))
        : {},
    }));
}

function normalizeQuotes(value: unknown): CaptureSummary["notableQuotes"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      author: stringValue(item.author) || "Unknown",
      quote: stringValue(item.quote),
      paraphrase: stringValue(item.paraphrase),
    }))
    .filter((item) => item.quote || item.paraphrase);
}

function normalizeTags(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean).slice(0, 12)
    : [];
}

function normalizeSummary(parsed: unknown, manifest: CaptureManifest): CaptureSummary {
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  return {
    title: stringValue(record.title) || manifest.title || "Meeting Summary",
    tldr: stringValue(record.tldr),
    summary: stringValue(record.summary),
    actionItems: normalizeActionItems(record.actionItems),
    notableQuotes: normalizeQuotes(record.notableQuotes),
    tags: normalizeTags(record.tags),
    raw: parsed,
  };
}

function buildSummaryPrompt(input: {
  manifest: CaptureManifest;
  transcriptMarkdown: string;
  profile: ReturnType<typeof readRecordingSummaryProfile>;
}) {
  const manifest = input.manifest;
  return [
    "You are a meeting synthesis assistant for Prism.",
    "Return valid JSON only. Do not include markdown fences or extra commentary.",
    "Summarize the meeting transcript and extract action items, notable quotes, and tags.",
    "The transcript may interleave spoken voice segments, browser-captured audio, and platform chat messages.",
    "Do not invent details not present in the transcript.",
    "",
    `Workspace summary profile source: ${input.profile.source}`,
    input.profile.content || "No additional workspace summary profile is configured.",
    "",
    "Use exactly this JSON schema:",
    "{",
    '  "title": "descriptive title",',
    '  "tldr": "short summary",',
    '  "summary": "detailed summary",',
    '  "actionItems": [{"name":"string","description":"string","assignedTo":"string or null","dueDate":"YYYY-MM-DD or null","params":{}}],',
    '  "notableQuotes": [{"author":"string","quote":"string","paraphrase":"string"}],',
    '  "tags": ["tag-1","tag-2","tag-3"]',
    "}",
    "",
    "Meeting metadata:",
    `- Capture ID: ${manifest.id}`,
    `- Title: ${manifest.title || "Browser capture"}`,
    `- Source: ${manifest.sourcePlatform || manifest.source}`,
    `- Started: ${new Date(manifest.startedAt).toISOString()}`,
    `- Ended: ${manifest.finalizedAt ? new Date(manifest.finalizedAt).toISOString() : "not finalized"}`,
    manifest.notes ? `- Operator notes: ${manifest.notes}` : "- Operator notes: none",
    "",
    "Transcript:",
    input.transcriptMarkdown.slice(0, 120_000),
  ].join("\n");
}

function renderSummaryMarkdown(manifest: CaptureManifest, summary: CaptureSummary) {
  const actionLines = summary.actionItems.length > 0
    ? summary.actionItems
        .map((item) => `- ${item.name}: ${item.description}${item.assignedTo ? ` (owner: ${item.assignedTo})` : ""}${item.dueDate ? ` (due: ${item.dueDate})` : ""}`)
        .join("\n")
    : "- None captured.";
  const quoteLines = summary.notableQuotes.length > 0
    ? summary.notableQuotes
        .map((item) => `- ${item.author}: "${item.quote}"${item.paraphrase ? `\n  - ${item.paraphrase}` : ""}`)
        .join("\n")
    : "- None captured.";

  return [
    `# ${summary.title || manifest.title || "Meeting Summary"}`,
    "",
    `- Capture: ${manifest.id}`,
    `- Source: ${manifest.sourcePlatform || manifest.source}`,
    `- Started: ${new Date(manifest.startedAt).toISOString()}`,
    `- Ended: ${manifest.finalizedAt ? new Date(manifest.finalizedAt).toISOString() : "not finalized"}`,
    summary.tags.length > 0 ? `- Tags: ${summary.tags.join(", ")}` : "- Tags: none",
    "",
    "## TL;DR",
    "",
    summary.tldr || "No short summary generated.",
    "",
    "## Summary",
    "",
    summary.summary || "No detailed summary generated.",
    "",
    "## Action Items",
    "",
    actionLines,
    "",
    "## Notable Quotes",
    "",
    quoteLines,
    "",
  ].join("\n");
}

export async function summarizeCaptureSession(captureId: string) {
  const manifest = await getCaptureManifest(captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  if (manifest.transcript?.status !== "completed") {
    throw new Error("CAPTURE_TRANSCRIPT_NOT_READY");
  }

  await markCaptureSummaryPending(captureId);
  try {
    const transcript = await readCaptureTranscriptFiles(captureId);
    const profile = readRecordingSummaryProfile();
    const prompt = buildSummaryPrompt({
      manifest: transcript.manifest,
      transcriptMarkdown: transcript.markdown,
      profile,
    });
    const parsed = safeJsonParse(await runtimeRequest({
      prompt,
      captureId,
      metadata: {
        purpose: "capture_meeting_summary",
        source: transcript.manifest.source,
        captureId,
      },
    }));
    const summary = normalizeSummary(parsed, transcript.manifest);
    const summaryMarkdown = renderSummaryMarkdown(transcript.manifest, summary);
    let completed = await writeCaptureSummaryFiles({
      captureId,
      jsonContent: JSON.stringify(summary, null, 2),
      markdownContent: summaryMarkdown,
    });
    const memory = await promoteMeetingSummaryToMemory({
      content: summaryMarkdown,
      title: summary.title,
      tldr: summary.tldr,
      source: "browser-capture",
      sourceId: transcript.manifest.id,
      sourceSystem: "browser-capture",
      timestamp: transcript.manifest.finalizedAt ?? transcript.manifest.startedAt,
      author: "Prism Browser Capture",
      metadata: {
        capture_id: transcript.manifest.id,
        request_id: transcript.manifest.requestId,
        started_at: transcript.manifest.startedAt,
        ended_at: transcript.manifest.finalizedAt,
        source_platform: transcript.manifest.sourcePlatform,
        action_items: summary.actionItems,
        tags: summary.tags,
      },
    }).catch((error): MeetingMemoryPromotionResult => ({
      ok: false,
      memoryPath: null,
      artifactUrl: null,
      skippedReason: error instanceof Error ? error.message : "PRISM_MEMORY_PROMOTION_FAILED",
    }));
    if (memory.memoryPath || memory.artifactUrl) {
      completed = await updateCaptureSummaryMemory({
        captureId,
        memoryPath: memory.memoryPath,
        memoryArtifactUrl: memory.artifactUrl,
      });
    }
    return {
      manifest: completed,
      summary: {
        ...summary,
        memory,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_SUMMARY_FAILED";
    await markCaptureSummaryFailed({ captureId, error: message }).catch(() => undefined);
    throw error;
  }
}
