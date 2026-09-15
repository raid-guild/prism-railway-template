import assert from "node:assert/strict";
import test from "node:test";
import { processInvocationSizeMetrics } from "./process-size.js";

test("process invocation metrics report byte counts without exposing values", () => {
  const metrics = processInvocationSizeMetrics({ SMALL: "ok", LARGE: "é" }, ["exec", "-"]);
  assert.deepEqual(metrics, {
    argumentBytes: 7,
    argumentCount: 2,
    environmentBytes: 18,
    environmentVariableCount: 2,
    largestEnvironmentVariableBytes: 9,
  });
  assert.equal(JSON.stringify(metrics).includes("SMALL"), false);
  assert.equal(JSON.stringify(metrics).includes("ok"), false);
});
