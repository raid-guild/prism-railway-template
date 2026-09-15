import assert from "node:assert/strict"
import test from "node:test"

import {
  extractRequestActionProposal,
  parsePrismLabRequestAskPayload,
  runPrismLabRequestAsk,
  type PrismLabRequestAskDependencies,
} from "./request-ask-service"

const workflow = {
  definition: {
    steps: [
      { key: "work", label: "Work", type: "agent" },
      { key: "status-check", label: "Status check", type: "checkpoint" },
      { key: "closed", label: "Closed", type: "terminal" },
    ],
  },
}

test("agent action proposals are bounded to configured workflow controls", () => {
  assert.deepEqual(extractRequestActionProposal(
    'I can check the external job after approval.\n```prism-action\n{"kind":"check-status","reason":"Poll the job now.","summary":"Check job status"}\n```',
    workflow,
    "status-check",
  ), {
    answer: "I can check the external job after approval.",
    proposedAction: { kind: "check-status", reason: "Poll the job now.", summary: "Check job status" },
  })
  assert.equal(extractRequestActionProposal(
    '```prism-action\n{"kind":"move-step","targetStepKey":"closed","runAfterMove":true,"reason":"Skip review.","summary":"Close it"}\n```',
    workflow,
    "work",
  ).proposedAction, null)
})

test("Ask Prism accepts only a bounded question without workflow authority fields", () => {
  assert.deepEqual(parsePrismLabRequestAskPayload({ question: "  What is blocking this?  " }), {
    ok: true,
    question: "What is blocking this?",
  })
  for (const field of ["workflowAction", "workflow_action", "requestedSkills", "requested_skills"]) {
    const result = parsePrismLabRequestAskPayload({ question: "Status?", [field]: null })
    assert.equal(result.ok, false)
  }
})

test("Ask Prism persists an isolated admin conversation without changing workflow events or runs", async () => {
  const workflowEvents = [{ id: "event-1", eventType: "gate.waiting", stepKey: "review" }]
  const agentRuns = [{ id: "run-1", kind: "workflow_step", status: "succeeded", workflowStepKey: "draft" }]
  const eventsBefore = structuredClone(workflowEvents)
  const runsBefore = structuredClone(agentRuns)
  const messages: Array<{
    id: string
    role: string
    content: string
    meta?: Record<string, unknown>
  }> = []
  let session = {
    id: "admin-session-1",
    source: "admin-console",
    meta: {
      transport: "site",
      contextKey: "prism-lab-request:request-1",
      kind: "prism-lab-request-ask",
    } as Record<string, unknown>,
  }
  let requestedContext: { source: string; contextKey: string } | null = null
  let runtimeCalls = 0

  const dependencies: PrismLabRequestAskDependencies = {
    getRequest: () => ({
      id: "request-1",
      requestNumber: 43,
      title: "Review the release",
      description: "Confirm the evidence before publishing.",
      workflowKey: "release",
      currentWorkflowStepKey: "review",
      workflowRunStatus: "active",
      workflowAttention: { status: "needs_attention", summary: "Human review required" },
      targetEnvironmentId: "environment-1",
      priority: "high",
    }),
    getWorkflowRun: () => ({ id: "workflow-run-1", status: "active", currentStepKey: "review" }),
    getWorkflow: () => ({ definition: { steps: [{ key: "review", type: "gate" }] } }),
    listAgentRuns: () => agentRuns,
    listWorkflowEvents: () => workflowEvents,
    listArtifacts: () => [{ id: "artifact-1", name: "verification.md", kind: "report" }],
    listExternalRefs: () => [{ provider: "github", kind: "pull_request", state: "open" }],
    findAdminSession: (input) => {
      requestedContext = input
      // An external request-linked session exists elsewhere, but this lookup is
      // deliberately scoped to the Lab admin conversation and returns no match.
      return null
    },
    createSession: (input) => {
      assert.equal(input.source, "admin-console")
      assert.equal(input.meta.contextKey, "prism-lab-request:request-1")
      return session
    },
    listMessages: () => [...messages],
    createMessage: (input) => {
      const message = {
        id: `message-${messages.length + 1}`,
        role: input.role,
        content: input.content,
        meta: input.meta,
      }
      messages.push(message)
      return message
    },
    updateSession: (_sessionId, input) => {
      session = { ...session, meta: input.meta }
      return session
    },
    invokeRuntime: async (input) => {
      runtimeCalls += 1
      assert.equal(input.authorityMode, "read_only_utility")
      assert.deepEqual(input.skills, [])
      assert.deepEqual(input.credentials, [])
      assert.equal(input.metadata.readOnlyUtility, true)
      assert.match(input.prompt, /does not execute workflow mutations/)
      assert.match(input.prompt, /authenticated, audited confirmation controls/)
      assert.match(input.prompt, /Human review required/)
      assert.match(input.prompt, /Operator question JSON: "What is blocking this request\?"/)
      return {
        responseText: "Request #43 is waiting at the review gate for human approval.",
        thread_id: "continuation-1",
        runtimeKey: "default-runtime",
      }
    },
    now: () => "2026-08-19T22:00:00.000Z",
  }

  const result = await runPrismLabRequestAsk(
    {
      requestId: "request-1",
      question: "What is blocking this request?",
      actorUserId: "user-1",
      actorDisplayName: "Ada Lovelace",
      actorHandle: "ada",
    },
    dependencies,
  )

  assert.deepEqual(requestedContext, {
    source: "admin-console",
    contextKey: "prism-lab-request:request-1",
  })
  assert.equal(runtimeCalls, 1)
  assert.deepEqual(messages.map(({ role, content }) => ({ role, content })), [
    { role: "user", content: "What is blocking this request?" },
    { role: "assistant", content: "Request #43 is waiting at the review gate for human approval." },
  ])
  assert.deepEqual(messages[0]?.meta, {
    transport: "site",
    kind: "request-ask",
    readOnlyUtility: true,
    actorUserId: "user-1",
    actorDisplayName: "Ada Lovelace",
    actorHandle: "ada",
  })
  assert.equal(result.messages.length, 2)
  assert.equal(result.session.source, "admin-console")
  assert.equal(result.session.meta.runtimeContinuationId, "continuation-1")
  assert.deepEqual(workflowEvents, eventsBefore)
  assert.deepEqual(agentRuns, runsBefore)
})
