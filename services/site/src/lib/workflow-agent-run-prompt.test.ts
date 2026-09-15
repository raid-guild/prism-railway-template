import assert from "node:assert/strict"
import test from "node:test"
import { buildWorkflowAgentRunPrompt } from "./workflow-agent-run-prompt"

test("anchors a gate continuation to the runnable agent step", () => {
  const prompt = buildWorkflowAgentRunPrompt({
    requestNumber: 361,
    requestTitle: "Portal blog post",
    stepKey: "publish-prep",
    stepLabel: "Publish Prep",
    operatorContext: "Continue workflow step review. No new admin comment was provided.",
  })

  assert.match(prompt, /^Run workflow step publish-prep for request #361: Portal blog post\./)
  assert.match(prompt, /Step label: Publish Prep\./)
  assert.match(prompt, /Complete this step and save its required durable artifacts before reporting success\./)
  assert.match(prompt, /Operator context:\nContinue workflow step review\./)
})
