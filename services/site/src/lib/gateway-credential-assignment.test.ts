import assert from "node:assert/strict";
import test from "node:test";
import { credentialsForSourceMode, trustedCredentialKeys } from "./gateway-credential-assignment";

const credentials = [{ key: "sendgrid" }, { key: "github" }];

test("only full-access source contexts receive credentials", () => {
  assert.deepEqual(credentialsForSourceMode("full", credentials), credentials);
  assert.deepEqual(credentialsForSourceMode("readonly", credentials), []);
  assert.deepEqual(credentialsForSourceMode("run-approved", credentials), []);
  assert.deepEqual(credentialsForSourceMode("off", credentials), []);
});

test("trusted credential assignments are stable and deduplicated", () => {
  assert.deepEqual(trustedCredentialKeys([...credentials, { key: "sendgrid" }]), ["sendgrid", "github"]);
});
