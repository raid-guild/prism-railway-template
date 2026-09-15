import {
  getCaptureManifest,
  markCaptureDispatchCompleted,
  markCaptureDispatchFailed,
  markCaptureDispatchPending,
  readCaptureSummaryFiles,
  readCaptureTranscriptFiles,
  type CaptureManifest,
} from "./capture-storage";
import { readCaptureDispatchSettings, type CaptureDispatchSettings } from "./capture-settings";
import { summarizeCaptureSession } from "./capture-summary";
import { triggerHook } from "@/lib/hook-trigger";

type CaptureDispatchPayload = {
  event: "capture.summary.completed";
  capture: CaptureManifest;
  transcript: {
    status: "completed";
    markdown: string | null;
    json: unknown | null;
    textOmitted: boolean;
    storagePath: string | null;
    jsonStoragePath: string | null;
    sharingAllowed: boolean;
  };
  summary: {
    markdown: string;
    json: unknown;
    memoryPath: string | null;
    artifactUrl: string | null;
  };
  policy: {
    rawTranscriptSharingAllowed: boolean;
  };
};

const activeDispatches = new Map<string, Promise<Awaited<ReturnType<typeof performCaptureDispatch>>>>();

function redactedSettings(settings: CaptureDispatchSettings) {
  return {
    destinationType: settings.destinationType,
    prismHookKey: settings.prismHookKey,
    externalUrl: settings.externalUrl,
    externalHeaderName: settings.externalHeaderName,
    externalHeaderValue: settings.externalHeaderValue ? "[redacted]" : null,
    autoDispatchOnTranscript: settings.autoDispatchOnTranscript,
  };
}

function externalDispatchTimeoutMs() {
  const parsed = Number.parseInt(process.env.CAPTURE_DISPATCH_EXTERNAL_TIMEOUT_MS ?? "10000", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 120_000) : 10_000;
}

async function buildDispatchPayload(captureId: string): Promise<CaptureDispatchPayload> {
  const transcript = await readCaptureTranscriptFiles(captureId);
  let summary = await readCaptureSummaryFiles(captureId).catch((error) => {
    if (error instanceof Error && error.message === "CAPTURE_SUMMARY_NOT_READY") return null;
    throw error;
  });
  if (!summary) {
    await summarizeCaptureSession(captureId);
    summary = await readCaptureSummaryFiles(captureId);
  }
  const includeTranscriptBody = ["1", "true", "yes", "on"].includes(
    (process.env.CAPTURE_DISPATCH_INCLUDE_TRANSCRIPT_BODY ?? "").trim().toLowerCase(),
  );
  const manifest = summary.manifest ?? transcript.manifest;
  const rawTranscriptSharingAllowed = false;
  return {
    event: "capture.summary.completed",
    capture: manifest,
    transcript: {
      status: "completed",
      markdown: includeTranscriptBody ? transcript.markdown : null,
      json: includeTranscriptBody ? transcript.json : null,
      textOmitted: !includeTranscriptBody,
      storagePath: manifest.transcript?.transcriptMarkdownPath ?? null,
      jsonStoragePath: manifest.transcript?.transcriptJsonPath ?? null,
      sharingAllowed: rawTranscriptSharingAllowed,
    },
    summary: {
      markdown: summary.markdown,
      json: summary.json,
      memoryPath: manifest.summary?.memoryPath ?? null,
      artifactUrl: manifest.summary?.memoryArtifactUrl ?? null,
    },
    policy: {
      rawTranscriptSharingAllowed,
    },
  };
}

async function dispatchToExternalHttp(settings: CaptureDispatchSettings, payload: CaptureDispatchPayload) {
  if (!settings.externalUrl) {
    throw new Error("CAPTURE_DISPATCH_EXTERNAL_URL_REQUIRED");
  }
  const url = new URL(settings.externalUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("CAPTURE_DISPATCH_EXTERNAL_URL_UNSUPPORTED_PROTOCOL");
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (settings.externalHeaderName && settings.externalHeaderValue) {
    headers[settings.externalHeaderName] = settings.externalHeaderValue;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), externalDispatchTimeoutMs());
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`CAPTURE_DISPATCH_EXTERNAL_FAILED:${response.status}:${responseText.slice(0, 300)}`);
    }
    return {
      status: response.status,
      body: responseText.slice(0, 1000),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`CAPTURE_DISPATCH_EXTERNAL_TIMEOUT:${externalDispatchTimeoutMs()}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function performCaptureDispatch(captureId: string, options: {
  baseUrl?: string | null;
  settings?: CaptureDispatchSettings;
} = {}) {
  const settings = options.settings ?? await readCaptureDispatchSettings();
  const manifest = await getCaptureManifest(captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  if (manifest.transcript?.status !== "completed") {
    throw new Error("CAPTURE_TRANSCRIPT_NOT_READY");
  }
  if (settings.destinationType === "none") {
    throw new Error("CAPTURE_DISPATCH_NOT_CONFIGURED");
  }

  const destination = settings.destinationType === "prism-hook"
    ? settings.prismHookKey
    : settings.externalUrl;
  if (!destination) {
    throw new Error("CAPTURE_DISPATCH_DESTINATION_REQUIRED");
  }

  await markCaptureDispatchPending({
    captureId,
    destinationType: settings.destinationType,
    destination,
  });

  try {
    const payload = await buildDispatchPayload(captureId);
    const result = settings.destinationType === "prism-hook"
      ? await triggerHook(settings.prismHookKey ?? "", payload, {
          baseUrl: options.baseUrl,
          source: `capture:${captureId}`,
          waitForAutoStart: false,
        })
      : await dispatchToExternalHttp(settings, payload);
    const updated = await markCaptureDispatchCompleted({
      captureId,
      destinationType: settings.destinationType,
      destination,
      result,
    });
    return {
      manifest: updated,
      result,
      settings: redactedSettings(settings),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_DISPATCH_FAILED";
    await markCaptureDispatchFailed({
      captureId,
      destinationType: settings.destinationType,
      destination,
      error: message,
    }).catch(() => undefined);
    throw error;
  }
}

export function dispatchCaptureTranscript(captureId: string, options: {
  baseUrl?: string | null;
  settings?: CaptureDispatchSettings;
} = {}) {
  const active = activeDispatches.get(captureId);
  if (active) return active;
  const dispatch = performCaptureDispatch(captureId, options).finally(() => {
    activeDispatches.delete(captureId);
  });
  activeDispatches.set(captureId, dispatch);
  return dispatch;
}
