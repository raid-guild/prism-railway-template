import assert from "node:assert/strict";
import test from "node:test";
import { ExternalInteractionRateLimiter } from "./external-interaction-rate-limit.js";

test("one interface cannot evade its limit by using multiple sessions", () => {
  let now = 1_000;
  const limiter = new ExternalInteractionRateLimiter(() => now);
  const limit = { windowSeconds: 60, maxRequests: 3 };

  assert.equal(limiter.check("portal", limit).ok, true); // create session A
  assert.equal(limiter.check("portal", limit).ok, true); // message in session A
  assert.equal(limiter.check("portal", limit).ok, true); // create session B
  assert.deepEqual(limiter.check("portal", limit), { ok: false, retryAfterSeconds: 60 });

  now += 60_000;
  assert.equal(limiter.check("portal", limit).ok, true);
});

test("separate interfaces have separate aggregate limits", () => {
  const limiter = new ExternalInteractionRateLimiter(() => 1_000);
  const limit = { windowSeconds: 30, maxRequests: 1 };

  assert.equal(limiter.check("portal", limit).ok, true);
  assert.equal(limiter.check("docs", limit).ok, true);
  assert.equal(limiter.check("portal", limit).ok, false);
  assert.equal(limiter.check("docs", limit).ok, false);
});
