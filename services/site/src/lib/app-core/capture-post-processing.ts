import { dispatchCaptureTranscript } from "./capture-dispatch";
import { captureAutoDispatchFailure, captureReadyForAutoDispatch } from "./capture-post-processing-state";
import { getCaptureManifest } from "./capture-storage";
import { readCaptureDispatchSettings } from "./capture-settings";

const activePostProcessing = new Map<string, Promise<void>>();

function postProcessingTimeoutMs() {
  const parsed = Number.parseInt(process.env.CAPTURE_POST_PROCESS_TIMEOUT_MS ?? "900000", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, 3_600_000)
    : 900_000;
}

function pollIntervalMs() {
  const parsed = Number.parseInt(process.env.CAPTURE_POST_PROCESS_POLL_MS ?? "1000", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(250, Math.min(parsed, 10_000))
    : 1000;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function runCapturePostProcessing(captureId: string, baseUrl: string | null) {
  const settings = await readCaptureDispatchSettings();
  if (!settings.autoDispatchOnTranscript || settings.destinationType === "none") return;

  const deadline = Date.now() + postProcessingTimeoutMs();
  while (Date.now() < deadline) {
    const manifest = await getCaptureManifest(captureId);
    if (!manifest) throw new Error("CAPTURE_NOT_FOUND");
    if (manifest.dispatch?.status === "completed") return;
    const transcriptionFailure = captureAutoDispatchFailure(manifest);
    if (transcriptionFailure) throw new Error(transcriptionFailure);
    if (captureReadyForAutoDispatch(manifest)) {
      await dispatchCaptureTranscript(captureId, { baseUrl, settings });
      return;
    }
    await delay(pollIntervalMs());
  }
  throw new Error("CAPTURE_POST_PROCESS_TIMEOUT");
}

export function queueCapturePostProcessing(captureId: string, options: { baseUrl?: string | null } = {}) {
  if (activePostProcessing.has(captureId)) return false;
  const job = runCapturePostProcessing(captureId, options.baseUrl ?? null)
    .catch((error) => {
      console.warn(JSON.stringify({
        event: "capture_post_processing_failed",
        captureId,
        error: error instanceof Error ? error.message : "CAPTURE_POST_PROCESS_FAILED",
      }));
    })
    .finally(() => {
      activePostProcessing.delete(captureId);
    });
  activePostProcessing.set(captureId, job);
  return true;
}
