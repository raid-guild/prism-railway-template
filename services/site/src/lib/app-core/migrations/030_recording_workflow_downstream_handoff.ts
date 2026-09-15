import type { Migration } from './index';

const recordingTranscriptWorkflow = {
  key: "recording-transcript-review-publish",
  name: "Recording Transcript Review Publish",
  version: 3,
  description: "Automated workflow for completed recording transcripts, Memory summary promotion, and generic downstream handoff planning.",
  entrypoint: "synthesize",
  workflowPath: "workflows/recording-transcript-review-publish/workflow.md",
  target: {
    kind: "none",
    required: false,
  },
  agentConfig: {
    runtime: "codex-runtime",
    mode: "main-agent",
    identity: "prism-recording-agent",
    model: null,
    reasoningEffort: null,
    skills: [],
    delegation: {
      allowed: false,
      maxAgents: 0,
    },
  },
  steps: [
    {
      key: "synthesize",
      label: "Synthesize",
      type: "agent",
      instructionPath: "workflows/recording-transcript-review-publish/steps/synthesize.md",
      next: "closed",
    },
    {
      key: "closed",
      label: "Closed",
      type: "terminal",
    },
  ],
};

const recordingTranscriptHookRequestTemplate = {
  titleTemplate: "Recording transcript completed - {{date}}",
  descriptionTemplate: [
    "A recording summary completed and was dispatched to Prism.",
    "",
    "Use the attached `hook-payload.json` artifact for capture metadata, summary content, transcript references, source event context, Memory promotion URLs, and downstream handoff planning.",
  ].join("\n"),
  requestType: "content",
  priority: "normal",
  acceptanceCriteria: [
    "Create durable meeting summary artifacts from the transcript and source metadata.",
    "Promote the meeting summary to Prism Memory by default when the Memory write path is configured; do not promote the raw transcript by default.",
    "Create a generic downstream handoff plan with source event metadata and recommended artifacts for any instance-specific follow-up workflow.",
    "Do not call workspace-specific publishing systems from the template built-in.",
    "Close the workflow without an operator gate unless the transcript is missing or unsafe to process.",
  ],
  constraints: {
    recordingWorkflow: {
      reviewBeforePublish: false,
      memoryIngest: "summary-default",
      rawTranscriptMemoryIngest: "skip-by-default",
      downstreamHandoff: "plan-only",
      delivery: "plan-only",
    },
  },
  agentRecommendation: "Use the completed recording summary and Memory artifact URL when present, synthesize from transcript references only when needed, and create a generic downstream handoff plan for instance-specific publishing workflows.",
};

const escapedWorkflow = JSON.stringify(recordingTranscriptWorkflow).replace(/'/g, "''");
const escapedRequestTemplate = JSON.stringify(recordingTranscriptHookRequestTemplate).replace(/'/g, "''");

export const recordingWorkflowDownstreamHandoffMigration: Migration = {
  name: '030_recording_workflow_downstream_handoff',
  sql: `
    UPDATE workflows
       SET name = 'Recording Transcript Review Publish',
           description = 'Automated workflow for completed recording transcripts, Memory summary promotion, and generic downstream handoff planning.',
           version = 3,
           definition_json = '${escapedWorkflow}',
           system_default = 1,
           enabled = 1,
           updated_at = datetime('now')
     WHERE key = 'recording-transcript-review-publish';

    UPDATE hooks
       SET name = 'Recording Transcript Completed',
           description = 'Creates an automated synthesis request when a browser capture or native recorder transcript completes.',
           workflow_key = 'recording-transcript-review-publish',
           auth_mode = 'service-token',
           request_template_json = '${escapedRequestTemplate}',
           system_default = 1,
           enabled = 1,
           updated_at = datetime('now')
     WHERE key = 'recording-transcript-completed';
  `,
};
