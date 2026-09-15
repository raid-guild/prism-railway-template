import { promises as fs } from "node:fs";
import {
  getCaptureManifest,
  markCaptureRecapFailed,
  markCaptureRecapPending,
  readCaptureTranscriptFiles,
  resolveCaptureStoragePath,
  writeCaptureRecapFiles,
  type CaptureManifest,
} from "./capture-storage";
import { runtimeRequest, safeJsonParse } from "./capture-summary";
import { readRecordingSummaryProfile } from "./recording-summary-profile";

export type CaptureRecap = {
  title: string;
  recap: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: Array<{
    description: string;
    owner: string | null;
    dueDate: string | null;
  }>;
  openQuestions: string[];
  confidence: "low" | "medium" | "high";
  raw?: unknown;
};

type TranscriptSource = {
  markdown: string;
  generatedAt: string | null;
  chunks: number;
  source: "aggregate-transcript" | "chunk-transcripts";
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringOrNull(value: unknown) {
  const valueString = stringValue(value);
  return valueString || null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean).slice(0, 20)
    : [];
}

function normalizeActionItems(value: unknown): CaptureRecap["actionItems"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      description: stringValue(item.description) || stringValue(item.name) || "Action item",
      owner: stringOrNull(item.owner) ?? stringOrNull(item.assignedTo),
      dueDate: stringOrNull(item.dueDate),
    }));
}

function normalizeConfidence(value: unknown): CaptureRecap["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizeRecap(parsed: unknown, manifest: CaptureManifest): CaptureRecap {
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  return {
    title: stringValue(record.title) || manifest.title || "Meeting Recap",
    recap: stringValue(record.recap) || stringValue(record.summary),
    keyPoints: stringArray(record.keyPoints),
    decisions: stringArray(record.decisions),
    actionItems: normalizeActionItems(record.actionItems),
    openQuestions: stringArray(record.openQuestions),
    confidence: normalizeConfidence(record.confidence),
    raw: parsed,
  };
}

async function readChunkTranscriptMarkdown(manifest: CaptureManifest): Promise<TranscriptSource | null> {
  const chunks = manifest.chunks
    .filter((chunk) => chunk.transcript?.status === "completed" && chunk.transcript.transcriptMarkdownPath)
    .sort((left, right) => left.index - right.index);
  if (chunks.length === 0) return null;

  const markdownParts = await Promise.all(
    chunks.map(async (chunk) => {
      const markdownPath = chunk.transcript?.transcriptMarkdownPath;
      if (!markdownPath) return "";
      return fs.readFile(resolveCaptureStoragePath(markdownPath), "utf8").catch(() => "");
    }),
  );
  const markdown = markdownParts.map((part) => part.trim()).filter(Boolean).join("\n\n---\n\n");
  if (!markdown) return null;

  const generatedAt = chunks
    .map((chunk) => chunk.transcript?.generatedAt ?? null)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  return {
    markdown,
    generatedAt,
    chunks: chunks.length,
    source: "chunk-transcripts",
  };
}

async function readCurrentTranscript(captureId: string, manifest: CaptureManifest): Promise<TranscriptSource> {
  const chunkTranscript = await readChunkTranscriptMarkdown(manifest);
  if (chunkTranscript) return chunkTranscript;

  if (manifest.transcript?.status === "completed") {
    const transcript = await readCaptureTranscriptFiles(captureId);
    return {
      markdown: transcript.markdown,
      generatedAt: manifest.transcript.generatedAt,
      chunks: manifest.transcript.chunksTranscribed,
      source: "aggregate-transcript",
    };
  }

  throw new Error("CAPTURE_TRANSCRIPT_CHUNKS_NOT_READY");
}

function buildRecapPrompt(input: {
  manifest: CaptureManifest;
  transcript: TranscriptSource;
  steering: string | null;
  profile: ReturnType<typeof readRecordingSummaryProfile>;
}) {
  return [
    "You are producing an in-progress meeting recap for Prism.",
    "Return valid JSON only. Do not include markdown fences or extra commentary.",
    "Use only the transcript evidence provided. If the meeting is sparse or the transcript is partial, say that plainly in the recap and set confidence to low.",
    "Keep the recap useful for someone joining the meeting now.",
    input.steering ? `Operator steering: ${input.steering}` : "Operator steering: none",
    "",
    `Workspace summary profile source: ${input.profile.source}`,
    input.profile.content || "No additional workspace summary profile is configured.",
    "",
    "Use exactly this JSON schema:",
    "{",
    '  "title": "short meeting title",',
    '  "recap": "concise current-state recap",',
    '  "keyPoints": ["point"],',
    '  "decisions": ["decision"],',
    '  "actionItems": [{"description":"string","owner":"string or null","dueDate":"YYYY-MM-DD or null"}],',
    '  "openQuestions": ["question"],',
    '  "confidence": "low|medium|high"',
    "}",
    "",
    "Capture metadata:",
    `- Capture ID: ${input.manifest.id}`,
    `- Title: ${input.manifest.title || "Browser capture"}`,
    `- Source: ${input.manifest.sourcePlatform || input.manifest.source}`,
    `- Started: ${new Date(input.manifest.startedAt).toISOString()}`,
    `- Finalized: ${input.manifest.finalizedAt ? new Date(input.manifest.finalizedAt).toISOString() : "not finalized"}`,
    `- Transcript source: ${input.transcript.source}`,
    `- Transcript chunks: ${input.transcript.chunks}`,
    input.manifest.notes ? `- Operator notes: ${input.manifest.notes}` : "- Operator notes: none",
    "",
    "Transcript so far:",
    input.transcript.markdown.slice(0, 120_000),
  ].join("\n");
}

function renderRecapMarkdown(input: {
  manifest: CaptureManifest;
  recap: CaptureRecap;
  transcript: TranscriptSource;
}) {
  const actions = input.recap.actionItems.length
    ? input.recap.actionItems
        .map((item) => `- ${item.description}${item.owner ? ` (owner: ${item.owner})` : ""}${item.dueDate ? ` (due: ${item.dueDate})` : ""}`)
        .join("\n")
    : "- None captured.";
  return [
    `# ${input.recap.title || input.manifest.title || "Meeting Recap"}`,
    "",
    `- Capture: ${input.manifest.id}`,
    `- Generated: ${new Date().toISOString()}`,
    `- Transcript source: ${input.transcript.source}`,
    `- Transcript chunks: ${input.transcript.chunks}`,
    `- Confidence: ${input.recap.confidence}`,
    "",
    "## Recap",
    "",
    input.recap.recap || "No recap generated.",
    "",
    "## Key Points",
    "",
    input.recap.keyPoints.length ? input.recap.keyPoints.map((item) => `- ${item}`).join("\n") : "- None captured.",
    "",
    "## Decisions",
    "",
    input.recap.decisions.length ? input.recap.decisions.map((item) => `- ${item}`).join("\n") : "- None captured.",
    "",
    "## Action Items",
    "",
    actions,
    "",
    "## Open Questions",
    "",
    input.recap.openQuestions.length ? input.recap.openQuestions.map((item) => `- ${item}`).join("\n") : "- None captured.",
    "",
  ].join("\n");
}

export async function recapCaptureSession(input: {
  captureId: string;
  steering?: string | null;
}) {
  const manifest = await getCaptureManifest(input.captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }

  await markCaptureRecapPending(input.captureId);
  try {
    const currentManifest = await getCaptureManifest(input.captureId);
    if (!currentManifest) throw new Error("CAPTURE_NOT_FOUND");
    const transcript = await readCurrentTranscript(input.captureId, currentManifest);
    const profile = readRecordingSummaryProfile();
    const parsed = safeJsonParse(await runtimeRequest({
      captureId: input.captureId,
      sessionId: `capture-recap-${input.captureId}`,
      metadata: {
        purpose: "capture_live_meeting_recap",
        source: currentManifest.source,
        captureId: input.captureId,
        transcriptSource: transcript.source,
        transcriptChunks: transcript.chunks,
      },
      prompt: buildRecapPrompt({
        manifest: currentManifest,
        transcript,
        steering: input.steering?.trim() || null,
        profile,
      }),
    }));
    const recap = normalizeRecap(parsed, currentManifest);
    const completed = await writeCaptureRecapFiles({
      captureId: input.captureId,
      jsonContent: JSON.stringify(recap, null, 2),
      markdownContent: renderRecapMarkdown({ manifest: currentManifest, recap, transcript }),
      transcriptGeneratedAt: transcript.generatedAt,
      transcriptChunks: transcript.chunks,
    });
    return {
      manifest: completed,
      recap,
      transcript,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_RECAP_FAILED";
    await markCaptureRecapFailed({ captureId: input.captureId, error: message }).catch(() => undefined);
    throw error;
  }
}
