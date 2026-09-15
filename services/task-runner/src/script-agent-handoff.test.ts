import assert from "node:assert/strict";
import test from "node:test";
import {
  applyScriptAgentHandoff,
  buildScriptAgentHandoffPrompt,
  decideScriptAgentHandoff,
  scriptAgentHandoffConfig,
  scriptResultShouldNotify,
} from "./script-agent-handoff.js";

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
      return { ok: true, status: 200, url: "runtime://job-1", body: JSON.stringify({ responseText: "Reviewed" }) };
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
});
