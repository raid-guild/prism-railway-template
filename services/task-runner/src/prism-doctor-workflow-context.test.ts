import assert from "node:assert/strict";
import test from "node:test";
import { workflowContextFindings } from "./prism-doctor-workflow-context.js";

test("warns about shared skills and an adjacent agent skill change", () => {
  const findings = workflowContextFindings({
    key: "member-highlight",
    definition: {
      agentConfig: { skills: ["portal-ops"] },
      steps: [
        { key: "research", type: "agent", agentConfig: { skills: ["research"] }, next: "draft" },
        { key: "draft", type: "agent", agentConfig: { skills: ["scribe"] }, next: "review" },
        { key: "review", type: "gate", next: "closed" },
        { key: "closed", type: "terminal" },
      ],
    },
  });

  assert.deepEqual(findings.map((finding) => finding.check), [
    "workflow-shared-skills-require-review",
    "workflow-agent-skill-change-has-context-boundary",
  ]);
  assert.deepEqual(findings[1]?.evidence, {
    nextStepKey: "draft",
    currentSkills: ["research"],
    nextSkills: ["scribe"],
  });
});

test("accepts a fresh step session with an artifact handoff", () => {
  const findings = workflowContextFindings({
    key: "member-highlight",
    definition: {
      agentConfig: { contextPolicy: { continuation: "step", handoff: "artifacts" } },
      steps: [
        { key: "research", type: "agent", agentConfig: { skills: ["research"] }, next: "draft" },
        { key: "draft", type: "agent", agentConfig: { skills: ["scribe"] }, next: "closed" },
        { key: "closed", type: "terminal" },
      ],
    },
  });

  assert.deepEqual(findings, []);
});

test("accepts a gate boundary between different agent skill sets", () => {
  const findings = workflowContextFindings({
    key: "member-highlight",
    definition: {
      steps: [
        { key: "research", type: "agent", agentConfig: { skills: ["research"] }, next: "research-review" },
        { key: "research-review", type: "gate", next: "draft" },
        { key: "draft", type: "agent", agentConfig: { skills: ["scribe"] }, next: "closed" },
        { key: "closed", type: "terminal" },
      ],
    },
  });

  assert.deepEqual(findings, []);
});

test("accepts adjacent agent steps with the same effective skills", () => {
  const findings = workflowContextFindings({
    key: "single-context",
    definition: {
      steps: [
        { key: "draft", type: "agent", agentConfig: { skills: ["scribe"] }, next: "revise" },
        { key: "revise", type: "agent", agentConfig: { skills: ["scribe"] }, next: "closed" },
        { key: "closed", type: "terminal" },
      ],
    },
  });

  assert.deepEqual(findings, []);
});
