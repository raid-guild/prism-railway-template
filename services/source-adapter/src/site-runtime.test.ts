import assert from "node:assert/strict";
import test from "node:test";
import { requestSiteRuntime } from "./site-runtime.js";

const siteEnvironmentNames = [
  "PRISM_AGENT_API_BASE_URL",
  "APP_API_BASE_URL",
  "PRISM_HOOKS_BASE_URL",
  "PRISM_AGENT_SERVICE_TOKEN",
  "APP_API_SERVICE_TOKEN",
  "PRISM_HOOK_SERVICE_TOKEN",
  "INTERNAL_SERVICE_TOKEN",
  "SERVICE_SHARED_TOKEN",
] as const;

function preserveSiteEnvironment() {
  const previous = new Map(siteEnvironmentNames.map((name) => [name, process.env[name]]));
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

test("source adapter delegates runtime selection to Site", async () => {
  const previousBaseUrl = process.env.PRISM_AGENT_API_BASE_URL;
  const previousToken = process.env.PRISM_AGENT_SERVICE_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.PRISM_AGENT_API_BASE_URL = "http://site.internal";
  process.env.PRISM_AGENT_SERVICE_TOKEN = "test-service-token";

  let capturedPrompt = "";
  let capturedCredentials: unknown = null;
  let capturedSkills: unknown = null;
  let capturedDispatcher: unknown = null;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "http://site.internal/agent/runtime/invoke");
    assert.equal(new Headers(init?.headers).get("x-service-token"), "test-service-token");
    const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    capturedPrompt = String(requestBody.prompt ?? "");
    capturedCredentials = requestBody.credentials;
    capturedSkills = requestBody.skills;
    capturedDispatcher = (init as RequestInit & { dispatcher?: unknown })?.dispatcher;
    return Response.json({
      ok: true,
      response: {
        responseText: "summary",
        thread_id: "grok-session-1",
        provider: "grok-build",
        runtimeKey: "grok-local",
      },
    });
  };

  try {
    const result = await requestSiteRuntime({
      prompt: "Summarize this meeting.",
      sessionId: "recording-1",
      credentials: [{ key: "sendgrid" }],
      skills: ["research-reader"],
      timeoutMs: 5_000,
      metadata: { purpose: "voice_meeting_summary" },
    });
    assert.equal(capturedPrompt, "Summarize this meeting.");
    assert.deepEqual(capturedCredentials, [{ key: "sendgrid" }]);
    assert.deepEqual(capturedSkills, ["research-reader"]);
    assert.ok(capturedDispatcher, "runtime requests use a dispatcher with an extended headers timeout");
    assert.deepEqual(result, {
      responseText: "summary",
      continuationId: "grok-session-1",
      provider: "grok-build",
      runtimeKey: "grok-local",
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBaseUrl === undefined) delete process.env.PRISM_AGENT_API_BASE_URL;
    else process.env.PRISM_AGENT_API_BASE_URL = previousBaseUrl;
    if (previousToken === undefined) delete process.env.PRISM_AGENT_SERVICE_TOKEN;
    else process.env.PRISM_AGENT_SERVICE_TOKEN = previousToken;
  }
});

test("source adapter configuration errors list supported Site URL fallbacks", async () => {
  const restore = preserveSiteEnvironment();
  try {
    delete process.env.PRISM_AGENT_API_BASE_URL;
    delete process.env.APP_API_BASE_URL;
    delete process.env.PRISM_HOOKS_BASE_URL;

    await assert.rejects(
      requestSiteRuntime({
        prompt: "test",
        sessionId: "test-session",
        timeoutMs: 100,
      }),
      /PRISM_AGENT_API_BASE_URL, APP_API_BASE_URL, or PRISM_HOOKS_BASE_URL is required/,
    );
  } finally {
    restore();
  }
});

test("source adapter configuration errors list supported Site token fallbacks", async () => {
  const restore = preserveSiteEnvironment();
  try {
    process.env.PRISM_AGENT_API_BASE_URL = "https://site.example.org";
    delete process.env.PRISM_AGENT_SERVICE_TOKEN;
    delete process.env.APP_API_SERVICE_TOKEN;
    delete process.env.PRISM_HOOK_SERVICE_TOKEN;
    delete process.env.INTERNAL_SERVICE_TOKEN;
    delete process.env.SERVICE_SHARED_TOKEN;

    await assert.rejects(
      requestSiteRuntime({
        prompt: "test",
        sessionId: "test-session",
        timeoutMs: 100,
      }),
      /PRISM_AGENT_SERVICE_TOKEN, APP_API_SERVICE_TOKEN, PRISM_HOOK_SERVICE_TOKEN, INTERNAL_SERVICE_TOKEN, or SERVICE_SHARED_TOKEN is required/,
    );
  } finally {
    restore();
  }
});
