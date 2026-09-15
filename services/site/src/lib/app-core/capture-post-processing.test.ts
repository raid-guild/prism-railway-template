import assert from "node:assert/strict";
import test from "node:test";
import {
  captureAutoDispatchFailure,
  captureReadyForAutoDispatch,
  type AutoDispatchCaptureState,
} from "./capture-post-processing-state";

function manifest(overrides: Partial<AutoDispatchCaptureState> = {}): AutoDispatchCaptureState {
  return {
    status: "finalized",
    chunks: [{
      transcript: {
        status: "completed",
      },
    }],
    transcript: {
      status: "completed",
    },
    ...overrides,
  };
}

test("capture waits for finalization before automatic dispatch", () => {
  assert.equal(captureReadyForAutoDispatch(manifest({ status: "recording" })), false);
});

test("capture waits for every rolling transcript chunk", () => {
  const ready = manifest();
  assert.equal(captureReadyForAutoDispatch({
    ...ready,
    chunks: [
      ...ready.chunks,
      { transcript: { status: "pending" } },
    ],
  }), false);
});

test("finalized capture with complete aggregate and chunks is ready", () => {
  assert.equal(captureReadyForAutoDispatch(manifest()), true);
});

test("aggregate transcription failure is reported without waiting for timeout", () => {
  assert.equal(
    captureAutoDispatchFailure(manifest({ transcript: { status: "failed" } })),
    "CAPTURE_TRANSCRIPTION_FAILED",
  );
});

test("chunk transcription failure is reported without waiting for timeout", () => {
  assert.equal(
    captureAutoDispatchFailure(manifest({ chunks: [{ transcript: { status: "failed" } }] })),
    "CAPTURE_CHUNK_TRANSCRIPTION_FAILED",
  );
});
