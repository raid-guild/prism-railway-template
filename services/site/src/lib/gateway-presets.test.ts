import assert from "node:assert/strict";
import test from "node:test";
import { nextcrmGatewayPreset, normalizeGatewayPresetOrigin, plausibleGatewayPreset } from "./gateway-presets";

test("presets define conventional credential environment names", () => {
  assert.equal(plausibleGatewayPreset.credentialEnvironmentName, "PLAUSIBLE_API_KEY");
  assert.equal(nextcrmGatewayPreset.credentialEnvironmentName, "NEXTCRM_API_TOKEN");
});

test("preset origins require a bare HTTPS origin", () => {
  assert.equal(normalizeGatewayPresetOrigin("https://plausible.example.org/"), "https://plausible.example.org");
  assert.equal(normalizeGatewayPresetOrigin("http://plausible.example.org"), null);
  assert.equal(normalizeGatewayPresetOrigin("https://user:secret@example.org"), null);
  assert.equal(normalizeGatewayPresetOrigin("https://example.org/api"), null);
});
