import assert from "node:assert/strict";
import test from "node:test";
import { buildAdvisoryMemoryInstructions } from "./external-interaction-memory-policy.js";

test("empty advisory Memory scope adds no prompt instructions", () => {
  assert.equal(buildAdvisoryMemoryInstructions({
    knowledgeSourceIds: [], buckets: [], instructions: "", enforcement: "instructions-only",
  }), "");
});

test("advisory Memory instructions name selectors and disclose non-enforcement", () => {
  const result = buildAdvisoryMemoryInstructions({
    knowledgeSourceIds: ["handbook"],
    buckets: ["governance"],
    instructions: "Prefer current policy documents.",
    enforcement: "instructions-only",
  });
  assert.match(result, /model instructions only; not an enforced authorization boundary/);
  assert.match(result, /knowledge source IDs: handbook/);
  assert.match(result, /buckets: governance/);
  assert.match(result, /Prefer current policy documents/);
});
