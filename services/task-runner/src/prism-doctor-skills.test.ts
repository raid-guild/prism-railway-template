import assert from "node:assert/strict";
import test from "node:test";
import { doctorMergeSkills } from "./prism-doctor-skills.js";

test("canonical Site metadata replaces stale runtime requirements completely", () => {
  const canonical = { name: "brand-ops", metadata: { "gateway-credentials": ["github"] } };
  const result = doctorMergeSkills([canonical], [{ name: "brand-ops", metadata: { "gateway-credentials": ["raidguild-brand-github"] }, staleField: true }]);
  assert.deepEqual(result.find(skill => skill.name === "brand-ops"), canonical);
});

test("removed requirements do not leak through and runtime-only skills remain", () => {
  const canonical = { name: "portal-ops" };
  const runtimeOnly = { name: "browser", source: "runtime" };
  const result = doctorMergeSkills([canonical], [{ name: " portal-ops ", gatewayCredentials: ["obsolete"] }, runtimeOnly]);
  assert.deepEqual(result, [canonical, runtimeOnly, { name: "imagegen", source: "codex-runtime" }]);
});

test("invalid names are ignored and imagegen metadata is not overwritten", () => {
  const imagegen = { name: "imagegen", source: "hosted", version: 2 };
  assert.deepEqual(doctorMergeSkills([imagegen, { name: " " }, {}], [{ name: "imagegen", version: 1 }, { name: 42 }]), [imagegen]);
});
