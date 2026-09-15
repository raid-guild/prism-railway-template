import type { Migration } from './index';

const recordingTranscriptWorkflow = {
  key: "recording-transcript-review-publish",
  name: "Recording Transcript Review Publish",
  version: 2,
  description: "Automated workflow for synthesizing completed recording transcripts, promoting summaries to Memory, and resolving Portal publishing.",
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
    "A recording transcript completed and was dispatched to Prism.",
    "",
    "Use the attached `hook-payload.json` artifact for the capture metadata, transcript, optional summary, Discord scheduled event context, and downstream routing hints.",
    "",
    "Payload:",
    "{{payload}}",
  ].join("\n"),
  requestType: "content",
  priority: "normal",
  acceptanceCriteria: [
    "Create durable meeting summary artifacts from the transcript and source metadata.",
    "Promote the meeting summary to Prism Memory by default when the Memory write path is configured; do not promote the raw transcript by default.",
    "Resolve an existing Portal session or create a Portal publish plan/result from payload and workspace context.",
    "Close the workflow without an operator gate unless the transcript is missing or unsafe to process.",
  ],
  constraints: {
    recordingWorkflow: {
      reviewBeforePublish: false,
      memoryIngest: "summary-default",
      rawTranscriptMemoryIngest: "skip-by-default",
      portalPublish: "resolve-or-plan",
      portalCreateWhenAllowed: true,
      delivery: "plan-only",
    },
  },
  agentRecommendation: "Synthesize the completed recording transcript, save durable summary artifacts, promote the summary to Memory when configured, and resolve or plan Portal publishing.",
};

const escapedWorkflow = JSON.stringify(recordingTranscriptWorkflow).replace(/'/g, "''");
const escapedRequestTemplate = JSON.stringify(recordingTranscriptHookRequestTemplate).replace(/'/g, "''");

export const recordingTranscriptPortalMemoryMigration: Migration = {
  name: '029_recording_transcript_portal_memory',
  sql: `
    UPDATE workflows
       SET name = 'Recording Transcript Review Publish',
           description = 'Automated workflow for synthesizing completed recording transcripts, promoting summaries to Memory, and resolving Portal publishing.',
           version = 2,
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
