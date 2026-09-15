import type { Migration } from './index';

const deterministicRecordingWorkflow = {
  key: "recording-transcript-review-publish",
  name: "Recording Transcript Review Publish",
  version: 4,
  description: "Deterministically prepares completed recording artifacts and optionally hands instance-specific publishing to a child workflow request.",
  hookProcessing: "deterministic-recording-v1",
  entrypoint: "closed",
  workflowPath: "workflows/recording-transcript-review-publish/workflow.md",
  target: {
    kind: "none",
    required: false,
  },
  steps: [
    {
      key: "closed",
      label: "Closed",
      type: "terminal",
    },
  ],
};

const escapedWorkflow = JSON.stringify(deterministicRecordingWorkflow).replace(/'/g, "''");

export const deterministicRecordingHandoffMigration: Migration = {
  name: '036_deterministic_recording_handoff',
  sql: `
    UPDATE workflows
       SET name = 'Recording Transcript Review Publish',
           description = 'Deterministically prepares completed recording artifacts and optionally hands instance-specific publishing to a child workflow request.',
           version = 4,
           definition_json = '${escapedWorkflow}',
           enabled = 1,
           updated_at = datetime('now')
     WHERE key = 'recording-transcript-review-publish'
       AND system_default = 1;

    UPDATE hooks
       SET description = 'Deterministically prepares artifacts for a completed recording and optionally creates an instance-specific downstream workflow request.',
           updated_at = datetime('now')
     WHERE key = 'recording-transcript-completed'
       AND system_default = 1;
  `,
};
