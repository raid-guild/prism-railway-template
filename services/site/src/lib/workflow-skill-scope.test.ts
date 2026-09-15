import assert from "node:assert/strict";
import test from "node:test";
import { continuationWorkflowRunSkills, initialWorkflowRunSkills } from "./workflow-skill-scope.js";

test("entry workflow runs combine one-run requested skills with step skills", () => {
  assert.deepEqual(initialWorkflowRunSkills({
    requestedSkills: ["hook-entry", "shared"],
    agentConfig: { skills: ["step", "shared"] },
    linkedWorkflow: true,
    isEntrypoint: true,
  }), ["hook-entry", "shared", "step"]);
});

test("non-entry workflow runs ignore browser and request-level skills", () => {
  assert.deepEqual(initialWorkflowRunSkills({
    requestedSkills: ["change-request-ops", "target-deploy-ops"],
    agentConfig: { skills: ["portal-ops"] },
    linkedWorkflow: true,
    isEntrypoint: false,
  }), ["portal-ops"]);
});

test("auto-continuations replace prior skills with the next step skills", () => {
  assert.deepEqual(continuationWorkflowRunSkills({ skills: ["scribe", "brand", "scribe"] }), ["scribe", "brand"]);
});
