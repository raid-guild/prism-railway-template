import assert from "node:assert/strict";
import test from "node:test";

import { projectActiveRequestAgentRuns } from "./active-run-projection";

test("board active-run projection excludes privileged run payload fields", () => {
  const privilegedRun = {
    id: "run-1",
    requestId: "request-1",
    status: "RUNNING",
    input: { prompt: "secret request context" },
    result: { hidden: true },
    trace: [{ message: "private trace" }],
    sessionId: "session-1",
    errorMessage: "private failure detail",
  };
  const projected = projectActiveRequestAgentRuns([privilegedRun]);

  assert.deepEqual(projected, [{ id: "run-1", requestId: "request-1", status: "running" }]);
  const serialized = JSON.stringify({ activeRequestAgentRuns: projected });
  for (const sensitiveKey of ["input", "result", "trace", "sessionId", "errorMessage"]) {
    assert.doesNotMatch(serialized, new RegExp(`"${sensitiveKey}"`));
  }
});

test("board active-run projection drops non-active and unlinked runs", () => {
  assert.deepEqual(projectActiveRequestAgentRuns([
    { id: "done", requestId: "request-1", status: "succeeded" },
    { id: "unlinked", requestId: null, status: "queued" },
  ]), []);
});
