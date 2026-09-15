import assert from "node:assert/strict";
import test from "node:test";

import { isPrismLabEnabled } from "./feature-flag";

test("Lab is default-on when the variable is absent or empty", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.equal(isPrismLabEnabled(value), true);
  }
});

test("only explicit false disables Lab", () => {
  assert.equal(isPrismLabEnabled("true"), true);
  assert.equal(isPrismLabEnabled(" TRUE "), true);
  assert.equal(isPrismLabEnabled("false"), false);
  assert.equal(isPrismLabEnabled(" FALSE "), false);
  assert.equal(isPrismLabEnabled("1"), true);
  assert.equal(isPrismLabEnabled("yes"), true);
  assert.equal(isPrismLabEnabled("enabled"), true);
});
