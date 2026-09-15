import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflowContextPolicies, workflowContinuationPolicy } from "./workflow-context-policy.js";

test("defaults workflow continuations to session", () => {
  assert.equal(workflowContinuationPolicy({}), "session");
});

test("accepts step continuation with artifact handoff", () => {
  const definition = {
    agentConfig: { contextPolicy: { continuation: "step", handoff: "artifacts" } },
    steps: [{ key: "draft", agentConfig: { contextPolicy: { continuation: "session" } } }],
  };
  assert.equal(validateWorkflowContextPolicies(definition), null);
  assert.equal(workflowContinuationPolicy(definition.agentConfig), "step");
});

test("rejects unsupported continuation policies", () => {
  assert.match(
    validateWorkflowContextPolicies({ agentConfig: { contextPolicy: { continuation: "shared" } }, steps: [] }) ?? "",
    /must be session or step/,
  );
});
