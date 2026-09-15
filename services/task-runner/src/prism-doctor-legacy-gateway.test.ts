import assert from "node:assert/strict";
import test from "node:test";
import { legacyGatewayWorkflowFindings } from "./prism-doctor-legacy-gateway.js";

test("flags legacy workflow toolset metadata and instruction files", () => {
  const findings = legacyGatewayWorkflowFindings({
    workflow: {
      key: "publish-post",
      definition: {
        agentConfig: { gatewayToolsets: ["portal.admin"] },
        steps: [{
          key: "publish",
          type: "agent",
          agentConfig: { gatewayCapabilities: ["portal.posts.create"] },
        }],
      },
    },
    detail: {
      steps: [{
        key: "publish",
        instructionContent: "Use portal.admin through PRISM_RUNTIME_TOOLSET_URL and PRISM_RUNTIME_TOOLSET_TOKEN.",
      }],
    },
  });

  assert.deepEqual(findings.map((finding) => finding.check), [
    "workflow-does-not-use-legacy-gateway-toolsets",
    "workflow-step-does-not-use-legacy-gateway-toolsets",
    "workflow-step-instructions-do-not-require-legacy-toolsets",
  ]);
  assert.equal(findings.every((finding) => finding.status === "failed"), true);
});

test("accepts credential-based provider access instructions", () => {
  const findings = legacyGatewayWorkflowFindings({
    workflow: {
      key: "publish-post",
      definition: {
        agentConfig: { gatewayCredentials: ["portal"] },
        steps: [{
          key: "publish",
          type: "agent",
          instructions: "Use rg-portal-ops with PORTAL_BASE_URL, PORTAL_EMAIL, and PORTAL_PASSWORD.",
        }],
      },
    },
  });

  assert.deepEqual(findings, []);
});

test("flags inline legacy toolset instructions without metadata", () => {
  const findings = legacyGatewayWorkflowFindings({
    workflow: {
      key: "publish-post",
      definition: {
        steps: [{
          key: "publish",
          type: "agent",
          instructions: "Call the Gateway HTTP toolset before continuing.",
        }],
      },
    },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.stepKey, "publish");
});
