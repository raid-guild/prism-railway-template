import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { requireRequestWorkflowKey, workflowSelectionHint } from "./request-workflow-selection";

test("missing, blank and malformed workflow selections never become code work", () => {
  for (const value of [undefined, null, "", "   ", 1, {}, []]) {
    assert.throws(() => requireRequestWorkflowKey(value), /WORKFLOW_KEY_REQUIRED/);
  }
});
test("shared creation rejects an omitted workflow before accessing persistence", async () => {
  const { createChangeRequest } = await import("./app-core/repository");
  assert.throws(() => createChangeRequest({
    title: "Add existing apps to Portal modules",
    description: "Create CMS records using existing APIs, not repository changes.",
    requestType: "content",
    priority: "normal",
  }), /WORKFLOW_KEY_REQUIRED/);
});
test("explicit code and operational workflow selections remain supported", () => {
  assert.equal(requireRequestWorkflowKey(" change-request-default "), "change-request-default");
  assert.equal(requireRequestWorkflowKey("portal-module-sync"), "portal-module-sync");
  assert.match(workflowSelectionHint, /existing APIs/);
});
test("API rejects missing selection before persistence or auto-start", () => {
  const route = readFileSync(new URL("../app/agent/change-board/requests/route.ts", import.meta.url), "utf8");
  assert.ok(route.indexOf("requireRequestWorkflowKey(body.") < route.indexOf("createChangeRequest({"));
  assert.match(route, /status: 400/);
  assert.match(route, /body.workflowKey \?\? body.workflow_key/);
  assert.doesNotMatch(route, /\|\| "change-request-default"/);
});
test("Portal modules regression: guidance checks operational lane before GitHub issues", () => {
  const triage = readFileSync(new URL("../../workflows/change-request-default/steps/triage.md", import.meta.url), "utf8");
  assert.match(triage, /Portal modules catalog/);
  assert.match(triage, /wrong-workflow-lane/);
  assert.ok(triage.indexOf("verify the execution lane") < triage.indexOf("create a GitHub issue"));
});
