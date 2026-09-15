import assert from "node:assert/strict";
import test from "node:test";
import { leaseGatewayCredentials, validateLeasedEnvironment } from "./gateway-lease.js";

test("leases credentials for a script job", async () => {
  let requestBody: Record<string, unknown> = {};
  const leased = await leaseGatewayCredentials({
    credentials: ["thegraph.read", "thegraph.read"],
    context: { delegatedActorId: "task:subgraph-api-health-check", runtimeJobId: "script-task:subgraph-api-health-check:1" },
    env: {
      PRISM_GATEWAY_ENABLED: "true",
      PRISM_GATEWAY_BASE_URL: "http://gateway.internal/",
      PRISM_GATEWAY_TOKEN: "task-runner-token",
    },
    fetchImpl: async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>)["x-gateway-token"], "task-runner-token");
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true, env: { SUBGRAPH_API_KEY: "secret" } }), { status: 200 });
    },
  });
  assert.deepEqual(requestBody.credentials, ["thegraph.read"]);
  assert.deepEqual(leased, { SUBGRAPH_API_KEY: "secret" });
});

test("fails closed when Gateway is not enabled", async () => {
  await assert.rejects(
    leaseGatewayCredentials({ credentials: ["thegraph.read"], context: {}, env: {} }),
    /SCRIPT_RUNNER_GATEWAY_DISABLED/,
  );
});

test("rejects platform environment names returned by Gateway", () => {
  assert.throws(
    () => validateLeasedEnvironment({ PRISM_AGENT_SERVICE_TOKEN: "secret" }),
    /SCRIPT_RUNNER_GATEWAY_ENV_PROTECTED/,
  );
  assert.throws(
    () => validateLeasedEnvironment({ NODE_OPTIONS: "--require=payload.js" }),
    /SCRIPT_RUNNER_GATEWAY_ENV_PROTECTED/,
  );
});
