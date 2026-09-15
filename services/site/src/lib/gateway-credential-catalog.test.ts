import assert from "node:assert/strict";
import test from "node:test";
import { leaseReadyGatewayCredentials } from "./gateway-credential-catalog";

test("excludes pending credentials whose bound secrets have not been stored", () => {
  assert.deepEqual(leaseReadyGatewayCredentials([{
    key: "raidguild-brand-github",
    status: "untested",
    envBindings: { GH_TOKEN: "token" },
    secretNames: [],
  }]), []);
});

test("includes untested credentials once every bound secret is stored", () => {
  assert.deepEqual(leaseReadyGatewayCredentials([{
    key: "raidguild-brand-github",
    status: "untested",
    envBindings: { GH_TOKEN: "token" },
    secretNames: ["token"],
  }]), [{ key: "raidguild-brand-github" }]);
});

test("includes configuration-only credentials without stored secrets", () => {
  assert.deepEqual(leaseReadyGatewayCredentials([{
    key: "public-api",
    status: "leased",
    envBindings: {},
    secretNames: [],
  }]), [{ key: "public-api" }]);
});

test("excludes revoked and malformed catalog entries", () => {
  assert.deepEqual(leaseReadyGatewayCredentials([
    { key: "revoked", status: "revoked", envBindings: {}, secretNames: [] },
    { key: "missing-bindings", status: "untested", secretNames: [] },
    { key: "bad-binding", status: "untested", envBindings: { TOKEN: null }, secretNames: [] },
    { key: "unknown-status", status: "pending", envBindings: {}, secretNames: [] },
  ]), []);
});
