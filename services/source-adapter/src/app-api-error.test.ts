import assert from "node:assert/strict";
import test from "node:test";

import { AppApiRequestError, isAppApiNotFound } from "./app-api-error.js";

test("classifies only typed App API 404 responses as an expected miss", () => {
  assert.equal(isAppApiNotFound(new AppApiRequestError(404, '{"error":"Agent session not found"}')), true);
  assert.equal(isAppApiNotFound(new AppApiRequestError(401, '{"error":"Unauthorized"}')), false);
  assert.equal(isAppApiNotFound(new Error("APP_API_REQUEST_FAILED:404:spoofed")), false);
});

test("bounds upstream error bodies without losing the response status", () => {
  const error = new AppApiRequestError(503, "x".repeat(500));
  assert.equal(error.status, 503);
  assert.equal(error.message, `APP_API_REQUEST_FAILED:503:${"x".repeat(200)}`);
});
