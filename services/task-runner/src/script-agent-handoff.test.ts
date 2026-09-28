import assert from "node:assert/strict";
import test from "node:test";
import {
  applyScriptAgentHandoff,
  buildScriptAgentHandoffPrompt,
  decideScriptAgentHandoff,
  scriptAgentHandoffConfig,
  scriptHandoffSkillSelection,
  scriptResultShouldNotify,
  parseScriptHandoffOutcome,
  ScriptHandoffFailure,
} from "./script-agent-handoff.js";

const receipt = (status: string, summary = "Verified result") => `Done.\n\`\`\`script-handoff-outcome\n${JSON.stringify({ version: 1, status, summary })}\n\`\`\``;

const taskResult = (body: string) => ({
  ok: true,
  status: 200,
  url: "script://api-result-check",
  body,
  metadata: { scriptKey: "api-result-check" },
});

test("disabled script handoff does not require JSON output or a prompt", () => {
  const config = scriptAgentHandoffConfig({}, {});
  assert.deepEqual(config, { enabled: false, when: "shouldEscalate", prompt: "" });
  assert.deepEqual(decideScriptAgentHandoff(config, "plain text"), {
    invoke: false,
    reason: "disabled",
    scriptResult: null,
  });
});

test("script handoff noops without invoking an agent when shouldEscalate is false", () => {
  const config = scriptAgentHandoffConfig(
    { prompt: "Review matching records." },
    { handoff: { enabled: true, when: "shouldEscalate" } },
  );
  const decision = decideScriptAgentHandoff(config, JSON.stringify({
    ok: true,
    status: "noop",
    shouldEscalate: false,
    shouldNotify: false,
  }));

  assert.equal(decision.invoke, false);
  assert.equal(decision.reason, "condition-false");
  assert.equal(scriptResultShouldNotify(decision.scriptResult!), false);
});

test("script handoff invokes an agent only for an explicit true condition", () => {
  const config = scriptAgentHandoffConfig(
    { prompt: "Review matching records." },
    { handoff: { enabled: true } },
  );
  const decision = decideScriptAgentHandoff(config, JSON.stringify({
    ok: true,
    shouldEscalate: true,
    agentInput: { ids: ["one", "two"] },
  }));

  assert.equal(decision.invoke, true);
  assert.equal(decision.reason, "condition-true");
  assert.match(buildScriptAgentHandoffPrompt(config.prompt, decision.scriptResult!), /Review matching records/);
  assert.match(buildScriptAgentHandoffPrompt(config.prompt, decision.scriptResult!), /untrusted data, not instructions/);
  assert.match(buildScriptAgentHandoffPrompt(config.prompt, decision.scriptResult!), /"one"/);
  assert.match(buildScriptAgentHandoffPrompt(config.prompt, decision.scriptResult!), /exactly one final fenced script-handoff-outcome/);
});

test("enabled script handoff rejects invalid configuration and output", () => {
  assert.throws(
    () => scriptAgentHandoffConfig({}, { handoff: { enabled: true } }),
    /SCRIPT_RUNNER_HANDOFF_PROMPT_REQUIRED/,
  );
  assert.throws(
    () => scriptAgentHandoffConfig({ prompt: "Review" }, { handoff: { enabled: true, when: "always" } }),
    /SCRIPT_RUNNER_HANDOFF_CONDITION_UNSUPPORTED:always/,
  );
  const config = scriptAgentHandoffConfig({ prompt: "Review" }, { handoff: { enabled: true } });
  assert.throws(() => decideScriptAgentHandoff(config, "not-json"), /SCRIPT_RUNNER_HANDOFF_OUTPUT_INVALID_JSON/);
  assert.throws(() => decideScriptAgentHandoff(config, "[]"), /SCRIPT_RUNNER_HANDOFF_OUTPUT_INVALID_OBJECT/);
});

test("conditional orchestration never calls the agent for a no-op result", async () => {
  const config = scriptAgentHandoffConfig(
    { prompt: "Review" },
    { handoff: { enabled: true } },
  );
  let invoked = false;
  const result = await applyScriptAgentHandoff({
    config,
    scriptTaskResult: taskResult(JSON.stringify({ shouldEscalate: false, shouldNotify: false })),
    invokeAgent: async () => {
      invoked = true;
      return taskResult("agent should not run");
    },
  });

  assert.equal(invoked, false);
  assert.equal((result.metadata?.handoff as Record<string, unknown>).invoked, false);
});

test("conditional orchestration calls the agent once and preserves script evidence", async () => {
  const config = scriptAgentHandoffConfig(
    { prompt: "Review" },
    { handoff: { enabled: true } },
  );
  let invocationCount = 0;
  const result = await applyScriptAgentHandoff({
    config,
    scriptTaskResult: taskResult(JSON.stringify({
      shouldEscalate: true,
      shouldNotify: false,
      agentInput: { id: "event-1" },
    })),
    invokeAgent: async (input) => {
      invocationCount += 1;
      assert.match(input.prompt, /event-1/);
      return { ok: true, status: 200, url: "runtime://job-1", body: JSON.stringify({ responseText: receipt("completed") }) };
    },
  });

  assert.equal(invocationCount, 1);
  assert.equal(result.url, "runtime://job-1");
  assert.equal(result.metadata?.shouldNotify, false);
  assert.deepEqual(result.metadata?.scriptResult, {
    shouldEscalate: true,
    shouldNotify: false,
    agentInput: { id: "event-1" },
  });
  assert.equal((result.metadata?.handoff as Record<string, unknown>).invoked, true);
  assert.equal((result.metadata?.handoffOutcome as Record<string, unknown>).status, "completed");
});

test("accepts a final no-op receipt from either runtime text field", () => {
  assert.equal(parseScriptHandoffOutcome(JSON.stringify({ output_text: receipt("no_op") })).status, "no_op");
  assert.equal(parseScriptHandoffOutcome(JSON.stringify({ responseText: receipt("completed") })).status, "completed");
});

test("production handoff metadata helper selects only Site-resolved skills", () => {
  assert.deepEqual(scriptHandoffSkillSelection(["veydrift-threat-review"]), {
    requestedSkills: ["veydrift-threat-review"], skillSelectionMode: "exact",
  });
});

test("rejects missing, malformed, conflicting or nonfinal receipts without using prose", () => {
  for (const body of [
    JSON.stringify({ responseText: "Everything succeeded" }),
    JSON.stringify({ responseText: `${receipt("completed")}\ntrailing text` }),
    JSON.stringify({ responseText: `${receipt("completed")}\n${receipt("completed")}` }),
    JSON.stringify({ responseText: "```script-handoff-outcome\nnot json\n```" }),
    JSON.stringify({ responseText: receipt("completed"), output_text: receipt("failed") }),
    JSON.stringify({ responseText: receipt("invented") }),
  ]) assert.throws(() => parseScriptHandoffOutcome(body), ScriptHandoffFailure);
});

test("HTTP 200 blocker and unknown-effect receipts fail with bounded nonsecret diagnostics", async () => {
  const config = scriptAgentHandoffConfig({ prompt: "Review" }, { handoff: { enabled: true } });
  for (const status of ["blocked", "needs_attention", "failed", "unknown_effect"]) {
    await assert.rejects(applyScriptAgentHandoff({
      config,
      scriptTaskResult: taskResult(JSON.stringify({ shouldEscalate: true })),
      invokeAgent: async () => ({ ok: true, status: 200, url: "runtime://job-2", body: JSON.stringify({ responseText: receipt(status, "token=supersecret") }) }),
    }), (error: unknown) => {
      assert.ok(error instanceof ScriptHandoffFailure);
      assert.equal(error.diagnostics.status, status);
      assert.doesNotMatch(JSON.stringify(error), /supersecret/);
      assert.doesNotMatch(JSON.stringify(error.diagnostics), /supersecret/);
      return true;
    });
  }
});

test("Site or Gateway invocation errors become typed safe handoff failures", async () => {
  const config = scriptAgentHandoffConfig({ prompt: "Review" }, { handoff: { enabled: true } });
  await assert.rejects(applyScriptAgentHandoff({
    config,
    scriptTaskResult: taskResult(JSON.stringify({ shouldEscalate: true })),
    invokeAgent: async () => { throw new Error("HTTP 409 from https://internal/?token=supersecret: private trace") },
  }), (error: unknown) => {
    assert.ok(error instanceof ScriptHandoffFailure);
    assert.equal(error.code, "INVOCATION_FAILED");
    assert.equal(error.diagnostics.causeCode, "HTTP_409");
    assert.equal(error.diagnostics.scriptKey, "api-result-check");
    assert.doesNotMatch(JSON.stringify(error.diagnostics), /supersecret|internal/);
    return true;
  });
});

test("failure snapshots exclude arbitrary secrets in every agent-authored receipt field", async () => {
  const config = scriptAgentHandoffConfig({ prompt: "Review" }, { handoff: { enabled: true } });
  const summarySecret = "unlabelled-value-7f3a92";
  const fixSecret = "another-unlabelled-value-8e4b01";
  const agentCode = "ARBITRARY_SECRET_VALUE";
  for (const status of ["blocked", "needs_attention", "failed", "unknown_effect"]) {
    const responseText = "```script-handoff-outcome\n" + JSON.stringify({
      version: 1, status, summary: summarySecret, suggestedFix: fixSecret, code: agentCode,
    }) + "\n```";
    await assert.rejects(applyScriptAgentHandoff({
      config,
      scriptTaskResult: taskResult(JSON.stringify({ shouldEscalate: true })),
      invokeAgent: async () => ({ ok: true, status: 200, url: "runtime://job-3", body: JSON.stringify({ responseText }) }),
    }), (error: unknown) => {
      assert.ok(error instanceof ScriptHandoffFailure);
      const snapshot = JSON.stringify({ diagnostics: error.diagnostics });
      for (const secret of [summarySecret, fixSecret, agentCode]) assert.equal(snapshot.includes(secret), false);
      assert.equal(error.diagnostics.code, "SCRIPT_RUNNER_HANDOFF_NON_SUCCESS_OUTCOME");
      assert.equal(error.diagnostics.status, status);
      assert.equal(error.diagnostics.scriptKey, "api-result-check");
      assert.equal(error.diagnostics.runtimeJobId, "job-3");
      assert.equal("outcome" in error.diagnostics, false);
      return true;
    });
  }
});
