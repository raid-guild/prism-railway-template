import assert from "node:assert/strict";
import test from "node:test";
import { readSkillCredentialRequirements } from "./hosted-skills";

test("hosted skill summaries accept credential assignment metadata", () => {
  assert.deepEqual(readSkillCredentialRequirements(`---
name: analytics-report
metadata:
  gateway-credentials:
    - plausible-production
---
`), ["plausible-production"]);
});

test("hosted skill requirements reject malformed credential keys", () => {
  assert.deepEqual(readSkillCredentialRequirements(`---
name: unsafe
metadata:
  gateway-credentials: [sendgrid, "../../secret", "bad key"]
---
`), ["sendgrid"]);
});
