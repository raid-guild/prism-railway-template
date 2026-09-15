import assert from "node:assert/strict"
import test from "node:test"

import { configurationPromptForFocus, parseConsolePromotion } from "./console-promotion"

test("console promotion accepts only bounded canonical request fields", () => {
  const result = parseConsolePromotion({
    sessionId: "session-1",
    title: "Investigate the release",
    description: "Determine whether the release is ready.",
    workflowKey: "change-request-default",
    targetAppId: "target-1",
    requestType: "issue",
    priority: "high",
    workflowAction: "arbitrary-step",
    requestedSkills: ["unsafe"],
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(Object.keys(result.value).sort(), ["description", "priority", "requestType", "sessionId", "targetAppId", "title", "workflowKey"])
  }
})
test("console promotion rejects oversized text and unsupported enums", () => {
  assert.equal(parseConsolePromotion({ sessionId: "s", title: "x".repeat(201), description: "d", workflowKey: "w", requestType: "issue", priority: "normal" }).ok, false)
  assert.equal(parseConsolePromotion({ sessionId: "s", title: "t", description: "d", workflowKey: "w", requestType: "root", priority: "normal" }).ok, false)
})

test("configuration assistance is allowlisted and explicitly credential-free", () => {
  const prompt = configurationPromptForFocus("gateway")
  assert.match(prompt, /non-secret/i)
  assert.match(prompt, /do not request credentials/i)
  assert.equal(configurationPromptForFocus("arbitrary"), "")
})
