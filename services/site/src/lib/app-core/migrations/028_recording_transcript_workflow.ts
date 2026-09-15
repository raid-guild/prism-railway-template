import type { Migration } from './index';

const recordingTranscriptWorkflow = {
  key: "recording-transcript-review-publish",
  name: "Recording Transcript Review Publish",
  version: 1,
  description: "Automated workflow for synthesizing completed recording transcripts and preparing downstream memory, portal, and delivery outputs.",
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
    "Use the attached `hook-payload.json` artifact for the capture metadata, transcript, and optional summary.",
    "",
    "Payload:",
    "{{payload}}",
  ].join("\n"),
  requestType: "content",
  priority: "normal",
  acceptanceCriteria: [
    "Create durable meeting summary artifacts from the transcript and source metadata.",
    "Prepare a reviewable memory/portal/delivery plan without automatically publishing private transcript content.",
    "Close the workflow without an operator gate unless the transcript is missing or unsafe to process.",
  ],
  constraints: {
    recordingWorkflow: {
      reviewBeforePublish: false,
      memoryIngest: "review",
      portalPublish: "plan-only",
      delivery: "plan-only",
    },
  },
  agentRecommendation: "Synthesize the completed recording transcript, save durable summary artifacts, and prepare downstream plans for memory, portal, and delivery.",
};

const escapedWorkflow = JSON.stringify(recordingTranscriptWorkflow).replace(/'/g, "''");
const escapedRequestTemplate = JSON.stringify(recordingTranscriptHookRequestTemplate).replace(/'/g, "''");
const escapedAutoRun = JSON.stringify({
  enabled: true,
  requestedSkills: [],
}).replace(/'/g, "''");

export const recordingTranscriptWorkflowMigration: Migration = {
  name: '028_recording_transcript_workflow',
  sql: `
    INSERT INTO workflows (
      id, key, name, description, version, definition_json, system_default, enabled, created_at, updated_at
    ) VALUES (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
      'recording-transcript-review-publish',
      'Recording Transcript Review Publish',
      'Automated workflow for synthesizing completed recording transcripts and preparing downstream memory, portal, and delivery outputs.',
      1,
      '${escapedWorkflow}',
      1,
      1,
      datetime('now'),
      datetime('now')
    )
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      version = excluded.version,
      definition_json = excluded.definition_json,
      system_default = excluded.system_default,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at;

    INSERT INTO hooks (
      id, key, name, description, enabled, workflow_key, auth_mode, request_template_json,
      auto_run_json, system_default, last_triggered_at, created_at, updated_at
    ) VALUES (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
      'recording-transcript-completed',
      'Recording Transcript Completed',
      'Creates an automated synthesis request when a browser capture or native recorder transcript completes.',
      1,
      'recording-transcript-review-publish',
      'service-token',
      '${escapedRequestTemplate}',
      '${escapedAutoRun}',
      1,
      NULL,
      datetime('now'),
      datetime('now')
    )
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      enabled = excluded.enabled,
      workflow_key = excluded.workflow_key,
      auth_mode = excluded.auth_mode,
      request_template_json = excluded.request_template_json,
      auto_run_json = excluded.auto_run_json,
      system_default = excluded.system_default,
      updated_at = excluded.updated_at;
  `,
};
