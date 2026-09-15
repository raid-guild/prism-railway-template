import assert from "node:assert/strict"
import test from "node:test"
import { validateScriptTaskHandoff } from "./script-task-handoff-input"

test("accepts disabled or correctly configured script agent handoffs", () => {
  assert.equal(validateScriptTaskHandoff({}, {}), null)
  assert.equal(validateScriptTaskHandoff(
    { prompt: "Review the matching records." },
    { handoff: { enabled: true, when: "shouldEscalate" } },
  ), null)
})

test("rejects script agent handoffs without a prompt or with an unsupported condition", () => {
  assert.match(
    validateScriptTaskHandoff({}, { handoff: { enabled: true } }) ?? "",
    /requires instructionConfig.prompt/,
  )
  assert.match(
    validateScriptTaskHandoff(
      { prompt: "Review" },
      { handoff: { enabled: true, when: "always" } },
    ) ?? "",
    /must be shouldEscalate/,
  )
})
