import assert from "node:assert/strict";
import test from "node:test";
import { discordDestinationType } from "./discord-output.js";

test("infers Discord forum destinations when the caller omits type", () => {
  assert.equal(discordDestinationType(null, 15), "discord-forum");
  assert.equal(discordDestinationType(undefined, 16), "discord-forum");
});

test("infers a normal Discord channel when the caller omits type", () => {
  assert.equal(discordDestinationType(null, 0), "discord-channel");
});

test("preserves an explicit destination type", () => {
  assert.equal(discordDestinationType("discord-forum", 0), "discord-forum");
});
