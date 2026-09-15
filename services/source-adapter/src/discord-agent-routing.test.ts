import assert from "node:assert/strict";
import test from "node:test";

import { discordAgentRoutingStatus, unconfiguredDiscordChannelMessage } from "./discord-agent-routing.js";

test("distinguishes an unconfigured transport from an explicitly disabled agent", () => {
  assert.equal(discordAgentRoutingStatus({ mode: "off" }), "unconfigured");
  assert.equal(discordAgentRoutingStatus({ mode: "off", agentResolutionFailed: true }), "unavailable");
  assert.equal(discordAgentRoutingStatus({ mode: "off", agentProfile: { key: "ops" } }), "disabled");
  assert.equal(discordAgentRoutingStatus({ mode: "readonly", agentProfile: { key: "ops" } }), "configured");
});

test("unconfigured response names the destination and setup surface", () => {
  const message = unconfiguredDiscordChannelMessage("123");
  assert.match(message, /no Agent Profile is configured/);
  assert.match(message, /Prism Lab → Agents/);
  assert.match(message, /`123`/);
});
