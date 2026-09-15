import { initialMigration } from './001_initial';
import { prismMaintenanceMigration } from './051_prism_maintenance';
import { dreamerAgentMigration } from './052_dreamer_agent';
import { badgeImageUrlMigration } from './002_badge_image_url';
import { targetAppsAndChangeRequestsMigration } from './003_target_apps_and_change_requests';
import { changeRequestExecutionsMigration } from './004_change_request_executions';
import { agentSessionsMigration } from './005_agent_sessions';
import { tasksMigration } from './006_tasks';
import { workflowsMigration } from './007_workflows';
import { workflowRunsMigration } from './008_workflow_runs';
import { nullableRequestTargetsMigration } from './009_nullable_request_targets';
import { requestArtifactsMigration } from './010_request_artifacts';
import { requestExternalRefsMigration } from './011_request_external_refs';
import { userInvitesMigration } from './012_user_invites';
import { hooksMigration } from './013_hooks';
import { closeCompletedWorkflowRequestsMigration } from './015_close_completed_workflow_requests';
import { dropChangeRequestStatusMigration } from './016_drop_change_request_status';
import { changeRequestPrReviewCheckpointMigration } from './017_change_request_pr_review_checkpoint';
import { agentResponseJobsMigration } from './018_agent_response_jobs';
import { taskScriptsMigration } from './019_task_scripts';
import { hookRunsMigration } from './020_hook_runs';
import { agentRunsMigration } from './021_agent_runs';
import { runLinksMigration } from './022_run_links';
import { requestArtifactRunLinksMigration } from './023_request_artifact_run_links';
import { requestHumanHoursEstimateMigration } from './024_request_human_hours_estimate';
import { agentRunQueueFieldsMigration } from './025_agent_run_queue_fields';
import { skillSourcesMigration } from './026_skill_sources';
import { simpleChangeRequestReviewGateMigration } from './027_simple_change_request_review_gate';
import { recordingTranscriptWorkflowMigration } from './028_recording_transcript_workflow';
import { recordingTranscriptPortalMemoryMigration } from './029_recording_transcript_portal_memory';
import { recordingWorkflowDownstreamHandoffMigration } from './030_recording_workflow_downstream_handoff';
import { runtimeProfilesMigration } from './031_runtime_profiles';
import { compactRecordingHookPayloadMigration } from './032_compact_recording_hook_payload';
import { workflowEventSequenceMigration } from './033_workflow_event_sequence';
import { externalInteractionsMigration } from './034_external_interactions';
import { interactionMemoryInstructionsMigration } from './035_interaction_memory_instructions';
import { deterministicRecordingHandoffMigration } from './036_deterministic_recording_handoff';
import { restoreRecordingSystemDefaultMigration } from './037_restore_recording_system_default';
import { hookAuthConfigMigration } from './038_hook_auth_config';
import { requestOriginsMigration } from './039_request_origins';
import { agentProfilesMigration } from './040_agent_profiles';
import { agentProfileAvatarMigration } from './041_agent_profile_avatar';
import { agentProfileAccentColorMigration } from './042_agent_profile_accent_color';
import { activeAgentExecutorFallbackMigration } from './043_active_agent_executor_fallback';
import { codeReviewAgentMigration } from './044_code_review_agent';
import { codeReviewAgentV2Migration } from './045_code_review_agent_v2';
import { codegenAgentMigration } from './046_codegen_agent';
import { verificationAgentMigration } from './047_verification_agent';
import { accountabilityDomainsMigration } from './048_accountability_domains';
import { agentProfileModelTierMigration } from './049_agent_profile_model_tier';
import { codeReviewConsoleMigration } from './050_code_review_console';

export interface Migration {
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  initialMigration,
  badgeImageUrlMigration,
  targetAppsAndChangeRequestsMigration,
  changeRequestExecutionsMigration,
  agentSessionsMigration,
  tasksMigration,
  workflowsMigration,
  workflowRunsMigration,
  nullableRequestTargetsMigration,
  requestArtifactsMigration,
  requestExternalRefsMigration,
  userInvitesMigration,
  hooksMigration,
  closeCompletedWorkflowRequestsMigration,
  dropChangeRequestStatusMigration,
  changeRequestPrReviewCheckpointMigration,
  agentResponseJobsMigration,
  taskScriptsMigration,
  hookRunsMigration,
  agentRunsMigration,
  runLinksMigration,
  requestArtifactRunLinksMigration,
  requestHumanHoursEstimateMigration,
  agentRunQueueFieldsMigration,
  skillSourcesMigration,
  simpleChangeRequestReviewGateMigration,
  recordingTranscriptWorkflowMigration,
  recordingTranscriptPortalMemoryMigration,
  recordingWorkflowDownstreamHandoffMigration,
  runtimeProfilesMigration,
  compactRecordingHookPayloadMigration,
  workflowEventSequenceMigration,
  externalInteractionsMigration,
  interactionMemoryInstructionsMigration,
  deterministicRecordingHandoffMigration,
  restoreRecordingSystemDefaultMigration,
  hookAuthConfigMigration,
  requestOriginsMigration,
  agentProfilesMigration,
  agentProfileAvatarMigration,
  agentProfileAccentColorMigration,
  activeAgentExecutorFallbackMigration,
  codeReviewAgentMigration,
  codeReviewAgentV2Migration,
  codegenAgentMigration,
  verificationAgentMigration,
  accountabilityDomainsMigration,
  agentProfileModelTierMigration,
  codeReviewConsoleMigration,
  prismMaintenanceMigration,
  dreamerAgentMigration,
];
