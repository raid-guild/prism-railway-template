import assert from "node:assert/strict";
import test from "node:test";
import { taskLifecycleFindings } from "./prism-doctor-task-lifecycle.js";

test("warns when a scheduled codex prompt delivers directly", () => {
  const findings = taskLifecycleFindings({
    key: "daily-report",
    enabled: true,
    triggerType: "schedule",
    taskType: "codex-prompt",
    outputConfig: {
      outputDestinations: [
        { adapter: "buzz", type: "buzz-channel", id: "channel-1", label: "ops" },
      ],
    },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.check, "scheduled-codex-prompt-needs-request-lifecycle");
  assert.deepEqual(findings[0]?.evidence, {
    enabled: true,
    destinationCount: 1,
    destinations: [
      { adapter: "buzz", type: "buzz-channel", id: "channel-1", label: "ops" },
    ],
  });
});

test("accepts request-backed workflow runner tasks", () => {
  assert.deepEqual(taskLifecycleFindings({
    key: "daily-report",
    triggerType: "schedule",
    taskType: "workflow-runner",
    outputConfig: {},
  }), []);
});

test("accepts deterministic alert delivery", () => {
  assert.deepEqual(taskLifecycleFindings({
    key: "health-watchdog",
    triggerType: "schedule",
    taskType: "script-runner",
    outputConfig: {
      outputDestinations: [
        { adapter: "discord", type: "discord-channel", id: "discord:1" },
      ],
    },
  }), []);
});

test("warns for scheduled codex prompts without external delivery", () => {
  const findings = taskLifecycleFindings({
    key: "scheduled-summary",
    triggerType: "schedule",
    taskType: "codex-prompt",
    outputConfig: { summary: true },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.evidence.destinationCount, 0);
});

test("accepts explicitly invoked codex prompt utilities", () => {
  assert.deepEqual(taskLifecycleFindings({
    key: "ephemeral-summary",
    triggerType: "manual",
    taskType: "codex-prompt",
    outputConfig: { summary: true },
  }), []);
});
