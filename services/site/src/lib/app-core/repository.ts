import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { loadConfig } from './config';
import { getDb } from './db';
import { getDefaultHomeModules, getHomeModuleDefinition, normalizeHomeModuleConfig } from './home-modules';
import { normalizeSiteContent, writeSiteContent } from './site-content';
import { taskAgentExecutor, taskUsesAgentExecutor, workflowAgentExecutor } from './agent-executors';
import { buildAccountabilitySnapshot } from './accountability-domains';
import {
  getRequestOrigin,
  insertRequestOrigin,
  listRequestOrigins,
  resolveRequestOriginSnapshot,
  type RequestOriginSnapshot,
} from './request-origin';

interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  is_banned: number;
  is_seeded: number;
}

interface ProfileRow {
  id: string;
  user_id: string | null;
  handle: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  wallet_address: string | null;
  email: string | null;
  links_json: string;
  skills_json: string;
  cohorts_json: string;
  location: string | null;
  contact_json: string;
  visibility: string;
  visibility_json: string;
  seed_source: string | null;
  seed_external_id: string | null;
  seeded_at: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
  points_total?: number;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  last_seen_at: string;
  created_at: string;
  revoked_at: string | null;
}

interface UserInviteRow {
  id: string;
  user_id: string;
  token_hash: string;
  kind: string;
  expires_at: string;
  used_at: string | null;
  created_by_user_id: string | null;
  created_at: string;
  email: string | null;
  handle: string | null;
  display_name: string | null;
}

interface CatalogSkillRow {
  id: number;
  slug: string;
  label: string;
  category: string | null;
  description: string | null;
  is_default: number;
  is_active: number;
}

interface CatalogCommunityRoleRow {
  id: number;
  slug: string;
  label: string;
  category: string | null;
  skill_type: string | null;
  description: string | null;
  is_default: number;
  is_active: number;
}

interface BadgeRow {
  slug: string;
  label: string;
  description: string | null;
  imageUrl: string | null;
}

type VisibilityScope = 'public' | 'members' | 'private';

type ProfileFieldVisibilityKey =
  | 'bio'
  | 'location'
  | 'links'
  | 'skills'
  | 'communityRoles'
  | 'badges'
  | 'cohorts';

export type ProfileVisibilitySettings = Record<ProfileFieldVisibilityKey, VisibilityScope>;

interface BadgeCatalogRow extends BadgeRow {
  id: number;
  createdAt: string;
  updatedAt: string;
}

interface AdminBadgeCatalogRow extends BadgeCatalogRow {
  awardCount: number;
}

interface SessionUserRow extends UserRow {
  handle: string | null;
  display_name: string | null;
}

export interface SessionUser {
  id: string;
  email: string | null;
  handle: string | null;
  displayName: string | null;
  roleSlugs: string[];
}

export interface PasswordLoginUser {
  id: string;
  email: string | null;
  passwordHash: string | null;
  isBanned: boolean;
}

export interface UserInviteRecord {
  id: string;
  userId: string;
  kind: 'invite' | 'reset';
  expiresAt: string;
  usedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  user: SessionUser;
}

export interface CreatedUserInvite extends UserInviteRecord {
  token: string;
}

export interface ProfileRecord {
  id: string;
  userId: string | null;
  handle: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  walletAddress: string | null;
  email: string | null;
  links: unknown[];
  skills: string[];
  communityRoles: string[];
  badges: BadgeRow[];
  cohorts: string[];
  location: string | null;
  contact: Record<string, unknown>;
  visibility: string;
  visibilitySettings: Partial<ProfileVisibilitySettings>;
  seededAt: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
  pointsTotal: number;
}

export interface RegisterInput {
  email: string;
  passwordHash: string;
  handle: string;
  displayName: string;
}

export interface UpdateProfileInput {
  handle?: string;
  displayName?: string;
  bio?: string | null;
  avatarUrl?: string | null;
  walletAddress?: string | null;
  location?: string | null;
  links?: unknown[];
  contact?: Record<string, unknown>;
  skillSlugs?: unknown[];
  communityRoleSlugs?: unknown[];
  visibility?: string;
  visibilitySettings?: Record<string, unknown>;
}

export interface MemberQuery {
  q?: string;
  skill?: string;
  communityRole?: string;
  limit?: number;
}

export interface AdminUserSummary {
  id: string;
  email: string | null;
  handle: string | null;
  displayName: string | null;
  isBanned: boolean;
  isSeeded: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  claimedAt: string | null;
  pointsTotal: number;
  roleSlugs: string[];
}

export interface AdminChangeRequestRecord {
  id: string;
  requestType: string;
  title: string;
  state: string;
  priority: string;
  payload: Record<string, unknown>;
  requestedByUserId: string | null;
  requestedByDisplayName: string | null;
  assignedToUserId: string | null;
  assignedToDisplayName: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface CreateAdminChangeRequestInput {
  requestType: string;
  title: string;
  priority?: string;
  payload?: Record<string, unknown>;
  requestedByUserId?: string | null;
  assignedToUserId?: string | null;
}

export interface UpdateAdminChangeRequestInput {
  state?: string;
  priority?: string;
  resolutionNote?: string | null;
  assignedToUserId?: string | null;
}

export interface AdminChangeRequestApplyResult {
  kind: 'points_adjustment' | 'badge_create' | 'badge_award' | 'badge_request' | 'site_content_update';
  affectedUserIds: string[];
  skippedUserIds: string[];
  pointsEntriesCreated?: number;
  badgeSlug?: string;
  badgeLabel?: string;
  badgeCreated?: boolean;
  badgeAwardsCreated?: number;
  siteContentUpdated?: boolean;
}

export interface AdminPointsAuditEntry {
  id: string;
  userId: string;
  memberHandle: string | null;
  memberDisplayName: string | null;
  delta: number;
  sourceType: string;
  sourceId: string | null;
  sourceTitle: string | null;
  reason: string;
  meta: Record<string, unknown>;
  actorUserId: string | null;
  actorDisplayName: string | null;
  createdAt: string;
}

export interface TargetAppRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  repoUrl: string | null;
  repoProvider: string | null;
  defaultBranch: string;
  framework: string | null;
  deployBackend: string;
  deployConfig: Record<string, unknown>;
  agentEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TargetEnvironmentRecord {
  id: string;
  targetAppId: string | null;
  targetAppSlug: string | null;
  slug: string;
  name: string;
  kind: string;
  branch: string | null;
  baseUrl: string | null;
  deployBackend: string;
  deployConfig: Record<string, unknown>;
  agentWritable: boolean;
  autoDeployEnabled: boolean;
  humanReviewRequired: boolean;
  isDefaultForAgent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeRequestRecord {
  id: string;
  requestNumber: number;
  workflowKey: string;
  title: string;
  description: string;
  requestType: string;
  priority: string;
  source: string;
  requestedByUserId: string | null;
  requestedByDisplayName: string | null;
  origin?: RequestOriginSnapshot | null;
  targetAppId?: string | null;
  targetAppSlug: string | null;
  targetAppName: string | null;
  targetEnvironmentId: string | null;
  targetEnvironmentSlug: string | null;
  targetEnvironmentName: string | null;
  currentWorkflowStepKey: string | null;
  workflowRunStatus: string | null;
  workflowAttention: WorkflowAttentionRecord | null;
  triageSummary: string | null;
  estimatedHumanHours: number | null;
  acceptanceCriteria: unknown[];
  constraints: Record<string, unknown>;
  attachments: unknown[];
  agentRecommendation: string | null;
  reviewNotes: string | null;
  resolutionSummary: string | null;
  createdAt: string;
  updatedAt: string;
  triagedAt: string | null;
  approvedForWorkAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
}

export interface WorkflowAttentionRecord {
  status: 'blocked' | 'needs_attention';
  summary: string | null;
  suggestedFix: string | null;
  blockers: Array<Record<string, unknown>>;
  agentRunId: string;
  workflowRunId: string | null;
  workflowStepKey: string | null;
  createdAt: string;
}

export interface ChangeRequestExecutionRecord {
  id: string;
  changeRequestId: string;
  targetEnvironmentId: string | null;
  targetEnvironmentSlug: string | null;
  status: string;
  actorType: string;
  branchName: string | null;
  commitSha: string | null;
  deployUrl: string | null;
  adapterKind: string | null;
  adapterStatus: string | null;
  summary: string | null;
  errorMessage: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface CreateTargetAppInput {
  slug: string;
  name: string;
  description?: string | null;
  repoUrl?: string | null;
  repoProvider?: string | null;
  defaultBranch?: string | null;
  framework?: string | null;
  deployBackend: string;
  deployConfig?: Record<string, unknown>;
  agentEnabled?: boolean;
}

export interface UpdateTargetAppInput {
  name?: string;
  description?: string | null;
  repoUrl?: string | null;
  defaultBranch?: string | null;
  agentEnabled?: boolean;
}

export interface CreateTargetEnvironmentInput {
  targetAppId: string;
  slug: string;
  name: string;
  kind: string;
  branch?: string | null;
  baseUrl?: string | null;
  deployBackend: string;
  deployConfig?: Record<string, unknown>;
  agentWritable?: boolean;
  autoDeployEnabled?: boolean;
  humanReviewRequired?: boolean;
  isDefaultForAgent?: boolean;
}

export interface UpdateTargetEnvironmentInput {
  branch?: string | null;
  agentWritable?: boolean;
  isDefaultForAgent?: boolean;
}

export interface ListChangeRequestsInput {
  targetAppId?: string;
  source?: string;
  platform?: string;
  originTargetId?: string;
  interactionProfileKey?: string;
  originActor?: string;
  query?: string;
  openOnly?: boolean;
  limit?: number;
}

export interface CreateChangeRequestInput {
  title: string;
  description: string;
  workflowKey?: string;
  requestType: string;
  priority?: string;
  source?: string;
  requestedByUserId?: string | null;
  /** Trusted Site-owned source session used to resolve immutable provenance. */
  sourceSessionId?: string | null;
  /** Optional source message within sourceSessionId; display identity is never accepted here. */
  sourceMessageId?: string | null;
  targetAppId?: string | null;
  targetEnvironmentId?: string | null;
  triageSummary?: string | null;
  estimatedHumanHours?: number | null;
  acceptanceCriteria?: unknown[];
  constraints?: Record<string, unknown>;
  attachments?: unknown[];
  agentRecommendation?: string | null;
}

export interface UpdateChangeRequestInput {
  workflowStepKey?: string | null;
  priority?: string;
  targetEnvironmentId?: string | null;
  triageSummary?: string | null;
  estimatedHumanHours?: number | null;
  reviewNotes?: string | null;
  resolutionSummary?: string | null;
  agentRecommendation?: string | null;
}

export interface AgentSessionRecord {
  id: string;
  source: string;
  status: string;
  title: string | null;
  discordGuildId: string | null;
  discordChannelId: string | null;
  discordThreadId: string | null;
  linkedChangeRequestId: string | null;
  linkedTargetEnvironmentId: string | null;
  meta: Record<string, unknown>;
  createdByUserId: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessageRecord {
  id: string;
  sessionId: string;
  role: string;
  source: string;
  sourceMessageId: string | null;
  content: string;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentResponseJobRecord {
  id: string;
  sessionId: string | null;
  status: string;
  input: Record<string, unknown>;
  response: Record<string, unknown>;
  outputText: string | null;
  errorMessage: string | null;
  trace: Array<Record<string, unknown>>;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunRecord {
  id: string;
  kind: string;
  status: string;
  lane: string;
  priority: number;
  idempotencyKey: string | null;
  requestId: string | null;
  workflowRunId: string | null;
  workflowStepKey: string | null;
  taskKey: string | null;
  hookKey: string | null;
  sessionId: string | null;
  agentProfileId: string | null;
  agentProfileVersion: number | null;
  executionMode: string | null;
  executorResolution: string | null;
  accountabilitySnapshot: Record<string, unknown>;
  source: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  trace: Array<Record<string, unknown>>;
  errorMessage: string | null;
  queuedAt: string;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  queueReason: string | null;
  queuePosition: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentResponseJobInput {
  sessionId?: string | null;
  input: Record<string, unknown>;
}

export interface UpdateAgentResponseJobInput {
  sessionId?: string | null;
  status?: string;
  response?: Record<string, unknown>;
  outputText?: string | null;
  errorMessage?: string | null;
  trace?: Array<Record<string, unknown>>;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface CreateAgentRunInput {
  kind: string;
  status?: string;
  lane?: string;
  priority?: number;
  idempotencyKey?: string | null;
  requestId?: string | null;
  workflowRunId?: string | null;
  workflowStepKey?: string | null;
  taskKey?: string | null;
  hookKey?: string | null;
  sessionId?: string | null;
  agentProfileId?: string | null;
  agentProfileVersion?: number | null;
  executionMode?: string | null;
  executorResolution?: string | null;
  accountabilitySnapshot?: Record<string, unknown>;
  source?: string;
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  trace?: Array<Record<string, unknown>>;
  errorMessage?: string | null;
  queuedAt?: string | null;
  claimedAt?: string | null;
  leaseExpiresAt?: string | null;
  queueReason?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface UpdateAgentRunInput {
  kind?: string;
  status?: string;
  lane?: string;
  priority?: number;
  idempotencyKey?: string | null;
  requestId?: string | null;
  workflowRunId?: string | null;
  workflowStepKey?: string | null;
  taskKey?: string | null;
  hookKey?: string | null;
  sessionId?: string | null;
  source?: string;
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  trace?: Array<Record<string, unknown>>;
  errorMessage?: string | null;
  queuedAt?: string | null;
  claimedAt?: string | null;
  leaseExpiresAt?: string | null;
  queueReason?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface UpsertAgentSessionInput {
  source: string;
  status?: string;
  title?: string | null;
  discordGuildId?: string | null;
  discordChannelId?: string | null;
  discordThreadId?: string | null;
  linkedChangeRequestId?: string | null;
  linkedTargetEnvironmentId?: string | null;
  meta?: Record<string, unknown>;
  createdByUserId?: string | null;
  lastMessageAt?: string | null;
}

export interface CreateAgentSessionInput {
  source: string;
  status?: string;
  title?: string | null;
  linkedChangeRequestId?: string | null;
  linkedTargetEnvironmentId?: string | null;
  meta?: Record<string, unknown>;
  createdByUserId?: string | null;
  lastMessageAt?: string | null;
}

export interface UpdateAgentSessionInput {
  status?: string;
  title?: string | null;
  linkedChangeRequestId?: string | null;
  linkedTargetEnvironmentId?: string | null;
  meta?: Record<string, unknown>;
  createdByUserId?: string | null;
  lastMessageAt?: string | null;
}

export interface CreateAgentMessageInput {
  sessionId: string;
  role: string;
  source: string;
  sourceMessageId?: string | null;
  content: string;
  meta?: Record<string, unknown>;
  createdAt?: string | null;
}

export interface TaskRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  triggerType: string;
  scheduleCron: string | null;
  timezone: string;
  taskType: string;
  inputConfig: Record<string, unknown>;
  instructionConfig: Record<string, unknown>;
  outputConfig: Record<string, unknown>;
  agentConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TaskScriptRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  runtime: string;
  enabled: boolean;
  storagePath: string;
  checksum: string;
  timeoutMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface HookRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  workflowKey: string;
  authMode: string;
  authConfig: Record<string, unknown>;
  requestTemplate: Record<string, unknown>;
  autoRun: Record<string, unknown>;
  systemDefault: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HookRunRecord {
  id: string;
  agentRunId: string | null;
  hookId: string | null;
  hookKey: string;
  hookName: string | null;
  workflowKey: string | null;
  status: string;
  source: string;
  requestId: string | null;
  requestNumber: number | null;
  requestTitle: string | null;
  autoStartQueued: boolean;
  autoStartStarted: boolean;
  errorMessage: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  version: number;
  definition: Record<string, unknown>;
  systemDefault: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunRecord {
  id: string;
  requestId: string;
  workflowKey: string;
  currentStepKey: string;
  status: string;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface WorkflowEventRecord {
  id: string;
  workflowRunId: string;
  requestId: string;
  stepKey: string | null;
  eventType: string;
  actorType: string;
  actorId: string | null;
  note: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RequestArtifactRecord {
  id: string;
  agentRunId: string | null;
  requestId: string;
  workflowRunId: string | null;
  executionId: string | null;
  kind: string;
  name: string;
  description: string | null;
  mimeType: string;
  storagePath: string;
  sizeBytes: number;
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RequestExternalRefRecord {
  id: string;
  requestId: string;
  provider: string;
  kind: string;
  externalId: string | null;
  title: string | null;
  url: string;
  state: string | null;
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRequestArtifactInput {
  id?: string;
  agentRunId?: string | null;
  requestId: string;
  workflowRunId?: string | null;
  executionId?: string | null;
  kind: string;
  name: string;
  description?: string | null;
  mimeType: string;
  storagePath: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
}

export interface UpsertRequestExternalRefInput {
  id?: string;
  requestId: string;
  provider: string;
  kind: string;
  externalId?: string | null;
  title?: string | null;
  url: string;
  state?: string | null;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
}

export interface TaskRunRecord {
  id: string;
  agentRunId: string | null;
  taskId: string;
  taskKey: string | null;
  taskName: string | null;
  status: string;
  triggerSource: string;
  startedAt: string | null;
  finishedAt: string | null;
  resultSummary: string | null;
  errorMessage: string | null;
  inputSnapshot: Record<string, unknown>;
  outputSnapshot: Record<string, unknown>;
  artifactRefs: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsertTaskInput {
  key: string;
  name: string;
  description?: string | null;
  enabled?: boolean;
  triggerType?: string;
  scheduleCron?: string | null;
  timezone?: string;
  taskType?: string;
  inputConfig?: Record<string, unknown>;
  instructionConfig?: Record<string, unknown>;
  outputConfig?: Record<string, unknown>;
  agentConfig?: Record<string, unknown>;
}

export interface UpsertTaskScriptInput {
  key: string;
  name: string;
  description?: string | null;
  runtime?: string;
  enabled?: boolean;
  storagePath: string;
  checksum: string;
  timeoutMs?: number | null;
}

export interface UpsertHookInput {
  key: string;
  name: string;
  description?: string | null;
  enabled?: boolean;
  workflowKey: string;
  authMode?: string;
  authConfig?: Record<string, unknown>;
  requestTemplate?: Record<string, unknown>;
  autoRun?: Record<string, unknown>;
  systemDefault?: boolean;
}

export interface CreateHookRunInput {
  hookId?: string | null;
  hookKey: string;
  hookName?: string | null;
  workflowKey?: string | null;
  source?: string | null;
  payload?: Record<string, unknown>;
  startedAt?: string | null;
}

export interface UpdateHookRunInput {
  status?: string;
  requestId?: string | null;
  requestNumber?: number | null;
  requestTitle?: string | null;
  autoStartQueued?: boolean;
  autoStartStarted?: boolean;
  errorMessage?: string | null;
  result?: Record<string, unknown>;
  finishedAt?: string | null;
}

export interface CreateTaskRunInput {
  taskKey: string;
  status?: string;
  triggerSource?: string;
  startedAt?: string | null;
  inputSnapshot?: Record<string, unknown>;
  outputSnapshot?: Record<string, unknown>;
  artifactRefs?: unknown[];
  resultSummary?: string | null;
  errorMessage?: string | null;
}

export interface UpdateTaskRunInput {
  status?: string;
  finishedAt?: string | null;
  resultSummary?: string | null;
  errorMessage?: string | null;
  inputSnapshot?: Record<string, unknown>;
  outputSnapshot?: Record<string, unknown>;
  artifactRefs?: unknown[];
}

interface HomeModuleRow {
  id: string;
  type: string;
  config_json: string;
  enabled: number;
  display_order: number;
  visibility_role: string | null;
  created_at: string;
  updated_at: string;
}

export interface HomeModuleRecord {
  id: string;
  type: string;
  label: string;
  description: string;
  config: Record<string, unknown>;
  enabled: boolean;
  displayOrder: number;
  visibilityRole: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateHomeModuleInput {
  id: string;
  enabled?: boolean;
  displayOrder?: number;
  visibilityRole?: string | null;
  config?: Record<string, unknown>;
}

function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function ensureHomeModulesSeeded() {
  const db = getDb();
  const now = new Date().toISOString();
  const insertModule = db.prepare(
    `INSERT INTO home_modules (id, type, config_json, enabled, display_order, visibility_role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );

  for (const moduleDefinition of getDefaultHomeModules()) {
    insertModule.run(
      moduleDefinition.id,
      moduleDefinition.type,
      JSON.stringify(moduleDefinition.defaultConfig),
      moduleDefinition.defaultEnabled ? 1 : 0,
      moduleDefinition.defaultDisplayOrder,
      moduleDefinition.defaultVisibilityRole,
      now,
      now,
    );
  }
}

function mapHomeModuleRow(row: HomeModuleRow): HomeModuleRecord {
  const definition = getHomeModuleDefinition(row.id, row.type);

  return {
    id: row.id,
    type: row.type,
    label: definition?.label || row.type,
    description: definition?.description || 'Configurable home module.',
    config: normalizeHomeModuleConfig(row.type, parseJsonValue<Record<string, unknown>>(row.config_json, {})),
    enabled: row.enabled === 1,
    displayOrder: row.display_order,
    visibilityRole: row.visibility_role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const DEFAULT_PROFILE_FIELD_VISIBILITY: ProfileVisibilitySettings = {
  bio: 'public',
  location: 'public',
  links: 'public',
  skills: 'public',
  communityRoles: 'public',
  badges: 'public',
  cohorts: 'public',
};

function normalizeVisibilityScope(value: unknown, fallback: VisibilityScope): VisibilityScope {
  return value === 'public' || value === 'members' || value === 'private' ? value : fallback;
}

function normalizeProfileVisibilitySettings(
  value: Record<string, unknown> | null | undefined,
): ProfileVisibilitySettings {
  return {
    bio: normalizeVisibilityScope(value?.bio, DEFAULT_PROFILE_FIELD_VISIBILITY.bio),
    location: normalizeVisibilityScope(value?.location, DEFAULT_PROFILE_FIELD_VISIBILITY.location),
    links: normalizeVisibilityScope(value?.links, DEFAULT_PROFILE_FIELD_VISIBILITY.links),
    skills: normalizeVisibilityScope(value?.skills, DEFAULT_PROFILE_FIELD_VISIBILITY.skills),
    communityRoles: normalizeVisibilityScope(
      value?.communityRoles,
      DEFAULT_PROFILE_FIELD_VISIBILITY.communityRoles,
    ),
    badges: normalizeVisibilityScope(value?.badges, DEFAULT_PROFILE_FIELD_VISIBILITY.badges),
    cohorts: normalizeVisibilityScope(value?.cohorts, DEFAULT_PROFILE_FIELD_VISIBILITY.cohorts),
  };
}

interface TaskRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabled: number;
  trigger_type: string;
  schedule_cron: string | null;
  timezone: string;
  task_type: string;
  input_config_json: string;
  instruction_config_json: string;
  output_config_json: string;
  agent_config_json: string;
  created_at: string;
  updated_at: string;
}

interface TaskScriptRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  runtime: string;
  enabled: number;
  storage_path: string;
  checksum: string;
  timeout_ms: number | null;
  created_at: string;
  updated_at: string;
}

interface WorkflowRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  version: number;
  definition_json: string;
  system_default: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface WorkflowRunRow {
  id: string;
  request_id: string;
  workflow_key: string;
  current_step_key: string;
  status: string;
  meta_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface WorkflowEventRow {
  id: string;
  workflow_run_id: string;
  request_id: string;
  step_key: string | null;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  note: string | null;
  payload_json: string;
  created_at: string;
}

interface RequestArtifactRow {
  id: string;
  agent_run_id: string | null;
  request_id: string;
  workflow_run_id: string | null;
  execution_id: string | null;
  kind: string;
  name: string;
  description: string | null;
  mime_type: string;
  storage_path: string;
  size_bytes: number;
  metadata_json: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface RequestExternalRefRow {
  id: string;
  request_id: string;
  provider: string;
  kind: string;
  external_id: string | null;
  title: string | null;
  url: string;
  state: string | null;
  metadata_json: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface TaskRunRow {
  id: string;
  agent_run_id: string | null;
  task_id: string;
  task_key: string | null;
  task_name: string | null;
  status: string;
  trigger_source: string;
  started_at: string | null;
  finished_at: string | null;
  result_summary: string | null;
  error_message: string | null;
  input_snapshot_json: string;
  output_snapshot_json: string;
  artifact_refs_json: string;
  created_at: string;
  updated_at: string;
}

interface AgentRunRow {
  id: string;
  kind: string;
  status: string;
  lane?: string | null;
  priority?: number | null;
  idempotency_key: string | null;
  request_id: string | null;
  workflow_run_id: string | null;
  workflow_step_key: string | null;
  task_key: string | null;
  hook_key: string | null;
  session_id: string | null;
  agent_profile_id?: string | null;
  agent_profile_version?: number | null;
  execution_mode?: string | null;
  executor_resolution?: string | null;
  accountability_snapshot_json?: string | null;
  source: string;
  input_json: string;
  result_json: string;
  trace_json: string;
  error_message: string | null;
  queued_at?: string | null;
  claimed_at?: string | null;
  lease_expires_at?: string | null;
  queue_reason?: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface HookRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabled: number;
  workflow_key: string;
  auth_mode: string;
  auth_config_json: string;
  request_template_json: string;
  auto_run_json: string;
  system_default: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

interface HookRunRow {
  id: string;
  agent_run_id: string | null;
  hook_id: string | null;
  hook_key: string;
  hook_name: string | null;
  workflow_key: string | null;
  status: string;
  source: string;
  request_id: string | null;
  request_number: number | null;
  request_title: string | null;
  auto_start_queued: number;
  auto_start_started: number;
  error_message: string | null;
  payload_json: string;
  result_json: string;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapTaskRow(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    triggerType: row.trigger_type,
    scheduleCron: row.schedule_cron,
    timezone: row.timezone,
    taskType: row.task_type,
    inputConfig: parseJsonValue<Record<string, unknown>>(row.input_config_json, {}),
    instructionConfig: parseJsonValue<Record<string, unknown>>(row.instruction_config_json, {}),
    outputConfig: parseJsonValue<Record<string, unknown>>(row.output_config_json, {}),
    agentConfig: parseJsonValue<Record<string, unknown>>(row.agent_config_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTaskScriptRow(row: TaskScriptRow): TaskScriptRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    runtime: row.runtime,
    enabled: row.enabled === 1,
    storagePath: row.storage_path,
    checksum: row.checksum,
    timeoutMs: row.timeout_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapHookRow(row: HookRow): HookRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    workflowKey: row.workflow_key,
    authMode: row.auth_mode,
    authConfig: parseJsonValue<Record<string, unknown>>(row.auth_config_json, {}),
    requestTemplate: parseJsonValue<Record<string, unknown>>(row.request_template_json, {}),
    autoRun: parseJsonValue<Record<string, unknown>>(row.auto_run_json, {}),
    systemDefault: row.system_default === 1,
    lastTriggeredAt: row.last_triggered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapHookRunRow(row: HookRunRow): HookRunRecord {
  return {
    id: row.id,
    agentRunId: row.agent_run_id,
    hookId: row.hook_id,
    hookKey: row.hook_key,
    hookName: row.hook_name,
    workflowKey: row.workflow_key,
    status: row.status,
    source: row.source,
    requestId: row.request_id,
    requestNumber: row.request_number,
    requestTitle: row.request_title,
    autoStartQueued: row.auto_start_queued === 1,
    autoStartStarted: row.auto_start_started === 1,
    errorMessage: row.error_message,
    payload: parseJsonValue<Record<string, unknown>>(row.payload_json, {}),
    result: parseJsonValue<Record<string, unknown>>(row.result_json, {}),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkflowRow(row: WorkflowRow): WorkflowRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    version: row.version,
    definition: parseJsonValue<Record<string, unknown>>(row.definition_json, {}),
    systemDefault: row.system_default === 1,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkflowRunRow(row: WorkflowRunRow): WorkflowRunRecord {
  return {
    id: row.id,
    requestId: row.request_id,
    workflowKey: row.workflow_key,
    currentStepKey: row.current_step_key,
    status: row.status,
    meta: parseJsonValue<Record<string, unknown>>(row.meta_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapWorkflowEventRow(row: WorkflowEventRow): WorkflowEventRecord {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    requestId: row.request_id,
    stepKey: row.step_key,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    note: row.note,
    payload: parseJsonValue<Record<string, unknown>>(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

function mapRequestArtifactRow(row: RequestArtifactRow): RequestArtifactRecord {
  return {
    id: row.id,
    agentRunId: row.agent_run_id,
    requestId: row.request_id,
    workflowRunId: row.workflow_run_id,
    executionId: row.execution_id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    mimeType: row.mime_type,
    storagePath: row.storage_path,
    sizeBytes: row.size_bytes,
    metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json, {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRequestExternalRefRow(row: RequestExternalRefRow): RequestExternalRefRecord {
  return {
    id: row.id,
    requestId: row.request_id,
    provider: row.provider,
    kind: row.kind,
    externalId: row.external_id,
    title: row.title,
    url: row.url,
    state: row.state,
    metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json, {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTaskRunRow(row: TaskRunRow): TaskRunRecord {
  return {
    id: row.id,
    agentRunId: row.agent_run_id,
    taskId: row.task_id,
    taskKey: row.task_key,
    taskName: row.task_name,
    status: row.status,
    triggerSource: row.trigger_source,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    resultSummary: row.result_summary,
    errorMessage: row.error_message,
    inputSnapshot: parseJsonValue<Record<string, unknown>>(row.input_snapshot_json, {}),
    outputSnapshot: parseJsonValue<Record<string, unknown>>(row.output_snapshot_json, {}),
    artifactRefs: parseJsonValue<unknown[]>(row.artifact_refs_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function extractTraceFromTaskOutputSnapshot(outputSnapshot: Record<string, unknown>) {
  const directTrace = outputSnapshot.trace;
  if (Array.isArray(directTrace)) {
    return directTrace.filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
    );
  }

  const body = outputSnapshot.body;
  if (typeof body !== 'string' || !body.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const nestedTrace = (parsed as Record<string, unknown>).trace;
    if (!Array.isArray(nestedTrace)) {
      return undefined;
    }
    return nestedTrace.filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
    );
  } catch {
    return undefined;
  }
}

function canViewerAccessField(scope: VisibilityScope, requesterUserId?: string | null) {
  if (scope === 'public') {
    return true;
  }

  if (scope === 'members') {
    return Boolean(requesterUserId);
  }

  return false;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeHandle(handle: string) {
  return handle.trim();
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAgentRunLane(value: unknown, fallback = 'workflow') {
  const lane = normalizeText(value);
  return lane === 'interactive' || lane === 'workflow' || lane === 'background' ? lane : fallback;
}

function inferAgentRunLane(input: { kind?: unknown; source?: unknown; lane?: unknown }) {
  const explicitLane = normalizeAgentRunLane(input.lane, '');
  if (explicitLane) return explicitLane;

  const kind = normalizeText(input.kind);
  const source = normalizeText(input.source);
  if (kind === 'console' || source === 'admin-console') return 'interactive';
  if (kind === 'task' || kind === 'background') return 'background';
  return 'workflow';
}

function normalizeAgentRunPriority(value: unknown, fallback: number) {
  const priority = Number(value);
  return Number.isFinite(priority) ? Math.trunc(priority) : fallback;
}

function defaultAgentRunPriority(lane: string) {
  if (lane === 'interactive') return 100;
  if (lane === 'background') return 10;
  return 50;
}

function addSecondsIso(now: Date, seconds: number) {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function normalizeExternalRefUrl(value: unknown) {
  const rawUrl = normalizeText(value);
  if (!rawUrl) return '';

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('EXTERNAL_REF_URL_INVALID');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('EXTERNAL_REF_URL_INVALID');
  }

  return parsed.toString();
}

function uniqueStrings(values: unknown) {
  if (!Array.isArray(values)) return [] as string[];

  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    seen.add(trimmed);
  }

  return [...seen];
}

function slugifyValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleizeSlug(value: string) {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function pointsTotalForUser(userId: string | null) {
  if (!userId) return 0;

  const row = getDb()
    .prepare('SELECT COALESCE(SUM(delta), 0) AS total FROM points_ledger WHERE user_id = ?')
    .get(userId) as { total: number } | undefined;

  return row?.total ?? 0;
}

function parseChangeRequestRow(
  row: {
    id: string;
    request_type: string;
    title: string;
    state: string;
    priority: string;
    payload_json: string;
    requested_by_user_id: string | null;
    requested_by_display_name: string | null;
    assigned_to_user_id: string | null;
    assigned_to_display_name: string | null;
    resolution_note: string | null;
    created_at: string;
    updated_at: string;
    resolved_at: string | null;
  },
) {
  return {
    id: row.id,
    requestType: row.request_type,
    title: row.title,
    state: row.state,
    priority: row.priority,
    payload: parseJsonValue<Record<string, unknown>>(row.payload_json, {}),
    requestedByUserId: row.requested_by_user_id,
    requestedByDisplayName: row.requested_by_display_name,
    assignedToUserId: row.assigned_to_user_id,
    assignedToDisplayName: row.assigned_to_display_name,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  } satisfies AdminChangeRequestRecord;
}

function parseTargetAppRow(row: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  repo_url: string | null;
  repo_provider: string | null;
  default_branch: string;
  framework: string | null;
  deploy_backend: string;
  deploy_config_json: string;
  agent_enabled: number;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    repoUrl: row.repo_url,
    repoProvider: row.repo_provider,
    defaultBranch: row.default_branch,
    framework: row.framework,
    deployBackend: row.deploy_backend,
    deployConfig: parseJsonValue<Record<string, unknown>>(row.deploy_config_json, {}),
    agentEnabled: Boolean(row.agent_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies TargetAppRecord;
}

function parseTargetEnvironmentRow(row: {
  id: string;
  target_app_id: string | null;
  target_app_slug: string | null;
  slug: string;
  name: string;
  kind: string;
  branch: string | null;
  base_url: string | null;
  deploy_backend: string;
  deploy_config_json: string;
  agent_writable: number;
  auto_deploy_enabled: number;
  human_review_required: number;
  is_default_for_agent: number;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    targetAppId: row.target_app_id,
    targetAppSlug: row.target_app_slug,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    branch: row.branch,
    baseUrl: row.base_url,
    deployBackend: row.deploy_backend,
    deployConfig: parseJsonValue<Record<string, unknown>>(row.deploy_config_json, {}),
    agentWritable: Boolean(row.agent_writable),
    autoDeployEnabled: Boolean(row.auto_deploy_enabled),
    humanReviewRequired: Boolean(row.human_review_required),
    isDefaultForAgent: Boolean(row.is_default_for_agent),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies TargetEnvironmentRecord;
}

function parseTrackedChangeRequestRow(row: {
  id: string;
  request_number: number;
  workflow_key: string;
  title: string;
  description: string;
  request_type: string;
  priority: string;
  source: string;
  requested_by_user_id: string | null;
  requested_by_display_name: string | null;
  target_app_id: string | null;
  target_app_slug: string | null;
  target_app_name: string | null;
  target_environment_id: string | null;
  target_environment_slug: string | null;
  target_environment_name: string | null;
  current_workflow_step_key?: string | null;
  workflow_run_status?: string | null;
  triage_summary: string | null;
  estimated_human_hours: number | null;
  acceptance_criteria_json: string | null;
  constraints_json: string | null;
  attachments_json: string | null;
  agent_recommendation: string | null;
  review_notes: string | null;
  resolution_summary: string | null;
  created_at: string;
  updated_at: string;
  triaged_at: string | null;
  approved_for_work_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
}) {
  return {
    id: row.id,
    requestNumber: row.request_number,
    workflowKey: row.workflow_key,
    title: row.title,
    description: row.description,
    requestType: row.request_type,
    priority: row.priority,
    source: row.source,
    requestedByUserId: row.requested_by_user_id,
    requestedByDisplayName: row.requested_by_display_name,
    origin: null,
    targetAppId: row.target_app_id,
    targetAppSlug: row.target_app_slug,
    targetAppName: row.target_app_name,
    targetEnvironmentId: row.target_environment_id,
    targetEnvironmentSlug: row.target_environment_slug,
    targetEnvironmentName: row.target_environment_name,
    currentWorkflowStepKey: row.current_workflow_step_key ?? null,
    workflowRunStatus: row.workflow_run_status ?? null,
    workflowAttention: null,
    triageSummary: row.triage_summary,
    estimatedHumanHours: row.estimated_human_hours,
    acceptanceCriteria: parseJsonValue<unknown[]>(row.acceptance_criteria_json, []),
    constraints: parseJsonValue<Record<string, unknown>>(row.constraints_json, {}),
    attachments: parseJsonValue<unknown[]>(row.attachments_json, []),
    agentRecommendation: row.agent_recommendation,
    reviewNotes: row.review_notes,
    resolutionSummary: row.resolution_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    triagedAt: row.triaged_at,
    approvedForWorkAt: row.approved_for_work_at,
    completedAt: row.completed_at,
    closedAt: row.closed_at,
  } satisfies ChangeRequestRecord;
}

function parseChangeRequestExecutionRow(row: {
  id: string;
  change_request_id: string;
  target_environment_id: string | null;
  target_environment_slug: string | null;
  status: string;
  actor_type: string;
  branch_name: string | null;
  commit_sha: string | null;
  deploy_url: string | null;
  adapter_kind: string | null;
  adapter_status: string | null;
  summary: string | null;
  error_message: string | null;
  meta_json: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}) {
  return {
    id: row.id,
    changeRequestId: row.change_request_id,
    targetEnvironmentId: row.target_environment_id,
    targetEnvironmentSlug: row.target_environment_slug,
    status: row.status,
    actorType: row.actor_type,
    branchName: row.branch_name,
    commitSha: row.commit_sha,
    deployUrl: row.deploy_url,
    adapterKind: row.adapter_kind,
    adapterStatus: row.adapter_status,
    summary: row.summary,
    errorMessage: row.error_message,
    meta: parseJsonValue<Record<string, unknown>>(row.meta_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  } satisfies ChangeRequestExecutionRecord;
}

function parseAgentSessionRow(row: {
  id: string;
  source: string;
  status: string;
  title: string | null;
  discord_guild_id: string | null;
  discord_channel_id: string | null;
  discord_thread_id: string | null;
  linked_change_request_id: string | null;
  linked_target_environment_id: string | null;
  meta_json: string;
  created_by_user_id: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    title: row.title,
    discordGuildId: row.discord_guild_id,
    discordChannelId: row.discord_channel_id,
    discordThreadId: row.discord_thread_id,
    linkedChangeRequestId: row.linked_change_request_id,
    linkedTargetEnvironmentId: row.linked_target_environment_id,
    meta: parseJsonValue<Record<string, unknown>>(row.meta_json, {}),
    createdByUserId: row.created_by_user_id,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies AgentSessionRecord;
}

function parseAgentMessageRow(row: {
  id: string;
  session_id: string;
  role: string;
  source: string;
  source_message_id: string | null;
  content: string;
  meta_json: string;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    source: row.source,
    sourceMessageId: row.source_message_id,
    content: row.content,
    meta: parseJsonValue<Record<string, unknown>>(row.meta_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies AgentMessageRecord;
}

function parseAgentResponseJobRow(row: {
  id: string;
  session_id: string | null;
  status: string;
  input_json: string;
  response_json: string;
  output_text: string | null;
  error_message: string | null;
  trace_json: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    input: parseJsonValue<Record<string, unknown>>(row.input_json, {}),
    response: parseJsonValue<Record<string, unknown>>(row.response_json, {}),
    outputText: row.output_text,
    errorMessage: row.error_message,
    trace: parseJsonValue<Array<Record<string, unknown>>>(row.trace_json, []),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies AgentResponseJobRecord;
}

function mapAgentRunRowsWithQueuePositions(rows: AgentRunRow[]) {
  const queuedLanes = Array.from(new Set(
    rows
      .filter((row) => row.status === 'queued')
      .map((row) => inferAgentRunLane({ lane: row.lane, kind: row.kind, source: row.source })),
  ));
  const positions = new Map<string, number>();
  if (queuedLanes.length) {
    const placeholders = queuedLanes.map(() => '?').join(', ');
    const queuedRows = getDb()
      .prepare(
        `SELECT id, lane
         FROM agent_runs
         WHERE status = 'queued'
           AND lane IN (${placeholders})
         ORDER BY lane ASC, priority DESC, COALESCE(queued_at, created_at) ASC, created_at ASC, id ASC`,
      )
      .all(...queuedLanes) as Array<{ id: string; lane: string }>;
    let currentLane = '';
    let lanePosition = 0;
    queuedRows.forEach((row) => {
      if (row.lane !== currentLane) {
        currentLane = row.lane;
        lanePosition = 0;
      }
      lanePosition += 1;
      positions.set(row.id, lanePosition);
    });
  }
  return rows.map((row) => mapAgentRunRow(row, {
    queuePosition: row.status === 'queued' ? positions.get(row.id) ?? null : null,
  }));
}

function mapAgentRunRow(row: AgentRunRow, input: { queuePosition?: number | null; computeQueuePosition?: boolean } = {}): AgentRunRecord {
  const lane = inferAgentRunLane({ lane: row.lane, kind: row.kind, source: row.source });
  const queuedAt = row.queued_at ?? row.created_at;
  const priority = normalizeAgentRunPriority(row.priority, defaultAgentRunPriority(lane));
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    lane,
    priority,
    idempotencyKey: row.idempotency_key,
    requestId: row.request_id,
    workflowRunId: row.workflow_run_id,
    workflowStepKey: row.workflow_step_key,
    taskKey: row.task_key,
    hookKey: row.hook_key,
    sessionId: row.session_id,
    agentProfileId: row.agent_profile_id ?? null,
    agentProfileVersion: row.agent_profile_version ?? null,
    executionMode: row.execution_mode ?? null,
    executorResolution: row.executor_resolution ?? null,
    accountabilitySnapshot: parseJsonValue<Record<string, unknown>>(row.accountability_snapshot_json ?? '{}', {}),
    source: row.source,
    input: parseJsonValue<Record<string, unknown>>(row.input_json, {}),
    result: parseJsonValue<Record<string, unknown>>(row.result_json, {}),
    trace: parseJsonValue<Array<Record<string, unknown>>>(row.trace_json, []),
    errorMessage: row.error_message,
    queuedAt,
    claimedAt: row.claimed_at ?? null,
    leaseExpiresAt: row.lease_expires_at ?? null,
    queueReason: row.queue_reason ?? null,
    queuePosition: row.status === 'queued'
      ? input.computeQueuePosition === false
        ? input.queuePosition ?? null
        : input.queuePosition ?? computeAgentRunQueuePosition({ id: row.id, lane, priority, queuedAt, createdAt: row.created_at })
      : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeWorkflowOutcomeStatus(value: unknown): 'blocked' | 'needs_attention' | 'completed' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/-/g, '_');
  return normalized === 'blocked' || normalized === 'needs_attention' || normalized === 'completed' ? normalized : null;
}

function normalizeWorkflowAttentionStatus(value: unknown): 'blocked' | 'needs_attention' | null {
  const normalized = normalizeWorkflowOutcomeStatus(value);
  return normalized === 'blocked' || normalized === 'needs_attention' ? normalized : null;
}

function workflowOutcomeStatusFromRun(run: AgentRunRecord) {
  const rawOutcome = run.result.workflowOutcome;
  if (!rawOutcome || typeof rawOutcome !== 'object' || Array.isArray(rawOutcome)) {
    return null;
  }
  return normalizeWorkflowOutcomeStatus((rawOutcome as Record<string, unknown>).status);
}

function workflowAttentionFromRun(run: AgentRunRecord): WorkflowAttentionRecord | null {
  const rawOutcome = run.result.workflowOutcome;
  if (!rawOutcome || typeof rawOutcome !== 'object' || Array.isArray(rawOutcome)) {
    return null;
  }
  const outcome = rawOutcome as Record<string, unknown>;
  const status = normalizeWorkflowAttentionStatus(outcome.status);
  if (!status) return null;
  const suggestedFix =
    normalizeText(outcome.suggestedFix) ||
    normalizeText(outcome.suggested_fix) ||
    null;
  return {
    status,
    summary: normalizeText(outcome.summary) || null,
    suggestedFix,
    blockers: Array.isArray(outcome.blockers)
      ? outcome.blockers.filter((entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
        )
      : [],
    agentRunId: run.id,
    workflowRunId: run.workflowRunId,
    workflowStepKey: run.workflowStepKey,
    createdAt: run.finishedAt ?? run.updatedAt,
  };
}

function workflowAttentionBlockerKeys(attention: WorkflowAttentionRecord) {
  return attention.blockers
    .map((blocker) => normalizeText(blocker.key))
    .filter((key): key is string => Boolean(key));
}

export function workflowAttentionResolved(attention: WorkflowAttentionRecord, events: WorkflowEventRecord[]) {
  const blockerKeys = new Set(workflowAttentionBlockerKeys(attention));
  return events.some((event) => {
    if (event.createdAt < attention.createdAt) {
      return false;
    }
    if (event.eventType === 'workflow.step_changed') {
      const previousStepKey = normalizeText(event.payload.previousStepKey);
      const nextStepKey = normalizeText(event.payload.nextStepKey) || event.stepKey;
      return Boolean(
        attention.workflowStepKey &&
        previousStepKey === attention.workflowStepKey &&
        nextStepKey !== attention.workflowStepKey
      );
    }
    if (event.eventType !== 'operator.blocker_overridden' && event.eventType !== 'operator.attention_resolved') {
      return false;
    }
    const agentRunId = normalizeText(event.payload.agentRunId);
    if (agentRunId && agentRunId === attention.agentRunId) {
      return true;
    }
    const payloadKeys = Array.isArray(event.payload.blockerKeys)
      ? event.payload.blockerKeys.map(normalizeText).filter((key): key is string => Boolean(key))
      : [];
    return payloadKeys.some((key) => blockerKeys.has(key));
  });
}

function workflowAttentionForRequestData(input: {
  agentRuns: AgentRunRecord[];
  events: WorkflowEventRecord[];
  currentStepKey: string | null;
}) {
  const clearedStepKeys = new Set<string>();
  for (const run of input.agentRuns) {
    const attention = workflowAttentionFromRun(run);
    if (attention?.workflowStepKey && input.currentStepKey && attention.workflowStepKey !== input.currentStepKey) {
      continue;
    }
    if (attention?.workflowStepKey && clearedStepKeys.has(attention.workflowStepKey)) {
      continue;
    }
    if (attention && !workflowAttentionResolved(attention, input.events)) {
      return attention;
    }
    if (
      !attention &&
      run.status === 'succeeded' &&
      run.workflowStepKey &&
      (run.result.workflowOutcome == null || workflowOutcomeStatusFromRun(run) === 'completed')
    ) {
      clearedStepKeys.add(run.workflowStepKey);
    }
  }
  return null;
}

export function getWorkflowAttentionForRequest(requestId: string): WorkflowAttentionRecord | null {
  return workflowAttentionForRequestData({
    agentRuns: listAgentRuns({ requestId, limit: 100 }),
    events: listWorkflowEventsForRequest(requestId, 200),
    currentStepKey: getWorkflowRunForRequest(requestId)?.currentStepKey ?? null,
  });
}

function listWorkflowAttentionForRequests(requests: ChangeRequestRecord[]) {
  const requestIds = requests.map((request) => request.id).filter(Boolean);
  const attentionByRequestId = new Map<string, WorkflowAttentionRecord | null>();
  for (const request of requests) {
    attentionByRequestId.set(request.id, null);
  }
  if (!requestIds.length) {
    return attentionByRequestId;
  }

  const placeholders = requestIds.map(() => '?').join(', ');
  const agentRunRows = getDb()
    .prepare(
      `SELECT *
       FROM (
         SELECT ar.*, ROW_NUMBER() OVER (PARTITION BY ar.request_id ORDER BY ar.created_at DESC) AS row_number
         FROM agent_runs ar
         WHERE ar.request_id IN (${placeholders})
       )
       WHERE row_number <= 100
       ORDER BY request_id ASC, created_at DESC`,
    )
    .all(...requestIds) as AgentRunRow[];
  const eventRows = getDb()
    .prepare(
      `SELECT *
       FROM (
         SELECT we.*, ROW_NUMBER() OVER (PARTITION BY we.request_id ORDER BY we.created_at DESC) AS row_number
         FROM workflow_events we
         WHERE we.request_id IN (${placeholders})
       )
       WHERE row_number <= 200
       ORDER BY request_id ASC, created_at DESC`,
    )
    .all(...requestIds) as WorkflowEventRow[];

  const agentRunsByRequestId = new Map<string, AgentRunRecord[]>();
  for (const row of agentRunRows) {
    if (!row.request_id) continue;
    const runs = agentRunsByRequestId.get(row.request_id) ?? [];
    runs.push(mapAgentRunRow(row, { queuePosition: null, computeQueuePosition: false }));
    agentRunsByRequestId.set(row.request_id, runs);
  }

  const eventsByRequestId = new Map<string, WorkflowEventRecord[]>();
  for (const row of eventRows) {
    const events = eventsByRequestId.get(row.request_id) ?? [];
    events.push(mapWorkflowEventRow(row));
    eventsByRequestId.set(row.request_id, events);
  }

  for (const request of requests) {
    attentionByRequestId.set(request.id, workflowAttentionForRequestData({
      agentRuns: agentRunsByRequestId.get(request.id) ?? [],
      events: eventsByRequestId.get(request.id) ?? [],
      currentStepKey: request.currentWorkflowStepKey,
    }));
  }

  return attentionByRequestId;
}

function withWorkflowAttention<T extends ChangeRequestRecord>(request: T, attention?: WorkflowAttentionRecord | null): T {
  return {
    ...request,
    workflowAttention: attention === undefined ? getWorkflowAttentionForRequest(request.id) : attention,
  };
}

function withRequestOrigin(request: ChangeRequestRecord, origin?: RequestOriginSnapshot | null): ChangeRequestRecord {
  return {
    ...request,
    origin: origin === undefined ? getRequestOrigin(request.id) : origin,
  };
}

function listSkillLabelsForUser(userId: string | null) {
  if (!userId) return [] as string[];

  const rows = getDb()
    .prepare(
      `SELECT s.label
       FROM user_skills us
       INNER JOIN skills_catalog s ON s.id = us.skill_id
       WHERE us.user_id = ?
       ORDER BY s.label ASC`,
    )
    .all(userId) as Array<{ label: string }>;

  return rows.map((row) => row.label);
}

function listCommunityRoleLabelsForUser(userId: string | null) {
  if (!userId) return [] as string[];

  const rows = getDb()
    .prepare(
      `SELECT c.label
       FROM user_community_roles ucr
       INNER JOIN community_roles_catalog c ON c.id = ucr.community_role_id
       WHERE ucr.user_id = ?
       ORDER BY c.label ASC`,
    )
    .all(userId) as Array<{ label: string }>;

  return rows.map((row) => row.label);
}

function syncUserSkillSlugs(userId: string, values: unknown[]) {
  const slugs = uniqueStrings(values).map(slugifyValue).filter(Boolean);
  const db = getDb();
  const now = new Date().toISOString();

  const rows = slugs.length
    ? db
      .prepare(
        `SELECT id
         FROM skills_catalog
         WHERE is_active = 1 AND slug IN (${slugs.map(() => '?').join(', ')})`,
      )
      .all(...slugs) as Array<{ id: number }>
    : [];

  db.prepare('DELETE FROM user_skills WHERE user_id = ?').run(userId);

  const insert = db.prepare(
    `INSERT INTO user_skills (user_id, skill_id, proficiency, created_at)
     VALUES (?, ?, NULL, ?)`,
  );

  for (const row of rows) {
    insert.run(userId, row.id, now);
  }
}

function syncUserCommunityRoleSlugs(userId: string, values: unknown[]) {
  const slugs = uniqueStrings(values).map(slugifyValue).filter(Boolean);
  const db = getDb();
  const now = new Date().toISOString();

  const rows = slugs.length
    ? db
      .prepare(
        `SELECT id
         FROM community_roles_catalog
         WHERE is_active = 1 AND slug IN (${slugs.map(() => '?').join(', ')})`,
      )
      .all(...slugs) as Array<{ id: number }>
    : [];

  db.prepare('DELETE FROM user_community_roles WHERE user_id = ?').run(userId);

  const insert = db.prepare(
    `INSERT INTO user_community_roles (user_id, community_role_id, created_at)
     VALUES (?, ?, ?)`,
  );

  for (const row of rows) {
    insert.run(userId, row.id, now);
  }
}

function listBadgesForUser(userId: string | null) {
  if (!userId) return [] as BadgeRow[];

  return getDb()
    .prepare(
      `SELECT b.slug, b.label, b.description, b.image_url AS imageUrl
       FROM user_badges ub
       INNER JOIN badges b ON b.id = ub.badge_id
       WHERE ub.user_id = ?
       ORDER BY ub.awarded_at DESC`,
    )
    .all(userId) as BadgeRow[];
}

function getBadgeBySlug(slug: string) {
  return getDb()
    .prepare(
      `SELECT
         id,
         slug,
         label,
         description,
         image_url AS imageUrl,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM badges
       WHERE slug = ?`,
    )
    .get(slug) as BadgeCatalogRow | undefined;
}

export function getAdminBadgeBySlug(slug: string) {
  return getDb()
    .prepare(
      `SELECT
         b.id,
         b.slug,
         b.label,
         b.description,
         b.image_url AS imageUrl,
         b.created_at AS createdAt,
         b.updated_at AS updatedAt,
         COUNT(ub.id) AS awardCount
       FROM badges b
       LEFT JOIN user_badges ub ON ub.badge_id = b.id
       WHERE b.slug = ?
       GROUP BY b.id, b.slug, b.label, b.description, b.image_url, b.created_at, b.updated_at`,
    )
    .get(slug) as AdminBadgeCatalogRow | undefined;
}

export function listBadgesCatalog() {
  return getDb()
    .prepare(
      `SELECT
         id,
         slug,
         label,
         description,
         image_url AS imageUrl,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM badges
       ORDER BY label ASC`,
    )
    .all() as BadgeCatalogRow[];
}

export function listAdminBadges() {
  return getDb()
    .prepare(
      `SELECT
         b.id,
         b.slug,
         b.label,
         b.description,
         b.image_url AS imageUrl,
         b.created_at AS createdAt,
         b.updated_at AS updatedAt,
         COUNT(ub.id) AS awardCount
       FROM badges b
       LEFT JOIN user_badges ub ON ub.badge_id = b.id
       GROUP BY b.id, b.slug, b.label, b.description, b.image_url, b.created_at, b.updated_at
       ORDER BY b.label ASC`,
    )
    .all() as AdminBadgeCatalogRow[];
}

function listExistingUserIds(userIds: string[]) {
  if (!userIds.length) return [] as string[];

  const placeholders = userIds.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`SELECT id FROM users WHERE id IN (${placeholders})`)
    .all(...userIds) as Array<{ id: string }>;

  return rows.map((row) => row.id);
}

function listExistingBadgeAwards(badgeId: number, userIds: string[]) {
  if (!userIds.length) return [] as string[];

  const placeholders = userIds.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`SELECT user_id FROM user_badges WHERE badge_id = ? AND user_id IN (${placeholders})`)
    .all(badgeId, ...userIds) as Array<{ user_id: string }>;

  return rows.map((row) => row.user_id);
}

function ensureBadgeRecord(input: { slug: string; label: string; description?: string | null; imageUrl?: string | null }) {
  const existing = getBadgeBySlug(input.slug);
  if (existing) {
    const nextDescription = input.description ?? existing.description;
    const nextImageUrl = input.imageUrl ?? existing.imageUrl;

    if (input.label && (input.label !== existing.label || nextDescription !== existing.description || nextImageUrl !== existing.imageUrl)) {
      getDb()
        .prepare('UPDATE badges SET label = ?, description = ?, image_url = ?, updated_at = ? WHERE id = ?')
        .run(input.label, nextDescription, nextImageUrl, new Date().toISOString(), existing.id);
      return { ...getBadgeBySlug(input.slug)!, created: false };
    }

    return { ...existing, created: false };
  }

  const now = new Date().toISOString();
  const result = getDb()
    .prepare('INSERT INTO badges (slug, label, description, image_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(input.slug, input.label, input.description ?? null, input.imageUrl ?? null, now, now);

  return {
    id: Number(result.lastInsertRowid),
    slug: input.slug,
    label: input.label,
    description: input.description ?? null,
    imageUrl: input.imageUrl ?? null,
    createdAt: now,
    updatedAt: now,
    created: true,
  };
}

export function upsertAdminBadge(input: { slug: string; label: string; description?: string | null; imageUrl?: string | null }) {
  const badge = ensureBadgeRecord(input);
  return getAdminBadgeBySlug(badge.slug);
}

export function updateAdminBadge(
  slug: string,
  input: { label?: string; description?: string | null; imageUrl?: string | null },
) {
  const existing = getBadgeBySlug(slug);
  if (!existing) {
    return null;
  }

  const nextLabel = normalizeText(input.label) || existing.label;
  const nextDescription = input.description === undefined ? existing.description : input.description;
  const nextImageUrl = input.imageUrl === undefined ? existing.imageUrl : input.imageUrl;

  getDb()
    .prepare('UPDATE badges SET label = ?, description = ?, image_url = ?, updated_at = ? WHERE slug = ?')
    .run(nextLabel, nextDescription, nextImageUrl, new Date().toISOString(), slug);

  return getAdminBadgeBySlug(slug);
}

function mapProfileRow(row: ProfileRow): ProfileRecord {
  const fallbackSkills = parseJsonValue<string[]>(row.skills_json, []);
  const visibilitySettings = normalizeProfileVisibilitySettings(
    parseJsonValue<Record<string, unknown>>(row.visibility_json, {}),
  );

  return {
    id: row.id,
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    walletAddress: row.wallet_address,
    email: row.email,
    links: parseJsonValue<unknown[]>(row.links_json, []),
    skills: row.user_id ? listSkillLabelsForUser(row.user_id) : fallbackSkills,
    communityRoles: row.user_id ? listCommunityRoleLabelsForUser(row.user_id) : [],
    badges: row.user_id ? listBadgesForUser(row.user_id) : [],
    cohorts: parseJsonValue<string[]>(row.cohorts_json, []),
    location: row.location,
    contact: parseJsonValue<Record<string, unknown>>(row.contact_json, {}),
    visibility: row.visibility,
    visibilitySettings,
    seededAt: row.seeded_at,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pointsTotal: typeof row.points_total === 'number' ? row.points_total : pointsTotalForUser(row.user_id),
  };
}

function sanitizePublicProfile(profile: ProfileRecord, requesterUserId?: string | null) {
  const visibilitySettings = normalizeProfileVisibilitySettings(profile.visibilitySettings);

  return {
    ...profile,
    bio: canViewerAccessField(visibilitySettings.bio, requesterUserId) ? profile.bio : null,
    location: canViewerAccessField(visibilitySettings.location, requesterUserId) ? profile.location : null,
    links: canViewerAccessField(visibilitySettings.links, requesterUserId) ? profile.links : [],
    skills: canViewerAccessField(visibilitySettings.skills, requesterUserId) ? profile.skills : [],
    communityRoles: canViewerAccessField(visibilitySettings.communityRoles, requesterUserId)
      ? profile.communityRoles
      : [],
    badges: canViewerAccessField(visibilitySettings.badges, requesterUserId) ? profile.badges : [],
    cohorts: canViewerAccessField(visibilitySettings.cohorts, requesterUserId) ? profile.cohorts : [],
    userId: null,
    email: null,
    contact: {},
    walletAddress: null,
    visibilitySettings: {},
    seededAt: null,
    claimedAt: null,
  } satisfies ProfileRecord;
}

function getProfileRowByUserId(userId: string) {
  return getDb()
    .prepare(
      `SELECT p.*, COALESCE(points.total_points, 0) AS points_total
       FROM profiles p
       LEFT JOIN (
         SELECT user_id, SUM(delta) AS total_points
         FROM points_ledger
         GROUP BY user_id
       ) points ON points.user_id = p.user_id
       WHERE p.user_id = ?`,
    )
    .get(userId) as ProfileRow | undefined;
}

function getProfileRowByHandle(handle: string) {
  return getDb()
    .prepare(
      `SELECT p.*, COALESCE(points.total_points, 0) AS points_total
       FROM profiles p
       LEFT JOIN (
         SELECT user_id, SUM(delta) AS total_points
         FROM points_ledger
         GROUP BY user_id
       ) points ON points.user_id = p.user_id
       WHERE LOWER(p.handle) = LOWER(?)`,
    )
    .get(handle) as ProfileRow | undefined;
}

export function listSkillsCatalog() {
  return getDb()
    .prepare(
      `SELECT id, slug, label, category, description, is_default, is_active
       FROM skills_catalog
       WHERE is_active = 1
       ORDER BY label ASC`,
    )
    .all() as CatalogSkillRow[];
}

export function listCommunityRolesCatalog() {
  return getDb()
    .prepare(
      `SELECT id, slug, label, category, skill_type, description, is_default, is_active
       FROM community_roles_catalog
       WHERE is_active = 1
       ORDER BY label ASC`,
    )
    .all() as CatalogCommunityRoleRow[];
}

export function getUserByEmail(email: string) {
  return getDb()
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(normalizeEmail(email)) as UserRow | undefined;
}

export function getPasswordLoginUserByEmail(email: string) {
  const user = getUserByEmail(email);
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.password_hash,
    isBanned: Boolean(user.is_banned),
  } satisfies PasswordLoginUser;
}

export function getUserById(userId: string) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
}

export function getSessionUserByTokenHash(tokenHash: string) {
  const row = getDb()
    .prepare(
      `SELECT u.*, p.handle, p.display_name
       FROM user_sessions s
       INNER JOIN users u ON u.id = s.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .get(tokenHash, new Date().toISOString()) as SessionUserRow | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    handle: row.handle,
    displayName: row.display_name,
    roleSlugs: listRoleSlugsForUser(row.id),
  } satisfies SessionUser;
}

export function touchSession(tokenHash: string) {
  getDb()
    .prepare('UPDATE user_sessions SET last_seen_at = ? WHERE token_hash = ?')
    .run(new Date().toISOString(), tokenHash);
}

export function createSession(session: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  lastSeenAt: string;
  createdAt: string;
}) {
  getDb()
    .prepare(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, last_seen_at, created_at)
       VALUES (@id, @userId, @tokenHash, @expiresAt, @lastSeenAt, @createdAt)`,
    )
    .run(session);
}

export function revokeSession(tokenHash: string) {
  getDb()
    .prepare('UPDATE user_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), tokenHash);
}

export function listRoleSlugsForUser(userId: string) {
  const rows = getDb()
    .prepare(
      `SELECT r.slug
       FROM user_roles ur
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ?`,
    )
    .all(userId) as Array<{ slug: string }>;

  return rows.map((row) => row.slug);
}

function hashInviteToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function mapUserInviteRow(row: UserInviteRow): UserInviteRecord {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind === 'reset' ? 'reset' : 'invite',
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    user: {
      id: row.user_id,
      email: row.email,
      handle: row.handle,
      displayName: row.display_name,
      roleSlugs: listRoleSlugsForUser(row.user_id),
    },
  };
}

export function createUserInvite(input: {
  userId: string;
  kind: 'invite' | 'reset';
  createdByUserId?: string | null;
  expiresInMs?: number;
}): CreatedUserInvite {
  const user = getUserById(input.userId);
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.expiresInMs ?? (input.kind === 'reset' ? 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000))).toISOString();
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO user_invites (
         id, user_id, token_hash, kind, expires_at, used_at, created_by_user_id, created_at
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(id, input.userId, hashInviteToken(token), input.kind, expiresAt, input.createdByUserId ?? null, now.toISOString());

  const invite = getUserInviteById(id);
  if (!invite) {
    throw new Error('INVITE_CREATE_FAILED');
  }
  return { ...invite, token };
}

export function getUserInviteById(id: string) {
  const row = getDb()
    .prepare(
      `SELECT
         i.id,
         i.user_id,
         i.token_hash,
         i.kind,
         i.expires_at,
         i.used_at,
         i.created_by_user_id,
         i.created_at,
         u.email,
         p.handle,
         p.display_name
       FROM user_invites i
       INNER JOIN users u ON u.id = i.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE i.id = ?`,
    )
    .get(id) as UserInviteRow | undefined;

  return row ? mapUserInviteRow(row) : null;
}

export function getActiveUserInviteByToken(token: string) {
  const row = getDb()
    .prepare(
      `SELECT
         i.id,
         i.user_id,
         i.token_hash,
         i.kind,
         i.expires_at,
         i.used_at,
         i.created_by_user_id,
         i.created_at,
         u.email,
         p.handle,
         p.display_name
       FROM user_invites i
       INNER JOIN users u ON u.id = i.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE i.token_hash = ?`,
    )
    .get(hashInviteToken(token)) as UserInviteRow | undefined;

  if (!row) return null;
  const invite = mapUserInviteRow(row);
  if (invite.usedAt || invite.expiresAt <= new Date().toISOString()) {
    return null;
  }
  return invite;
}

export function claimUserInvite(input: {
  token: string;
  passwordHash: string;
  displayName?: string | null;
}) {
  const invite = getActiveUserInviteByToken(input.token);
  if (!invite) {
    throw new Error('INVALID_INVITE');
  }

  const now = new Date().toISOString();
  const transaction = getDb().transaction(() => {
    getDb()
      .prepare(
        `UPDATE users
         SET password_hash = ?, updated_at = ?, last_seen_at = ?
         WHERE id = ?`,
      )
      .run(input.passwordHash, now, now, invite.userId);

    if (input.displayName?.trim()) {
      getDb()
        .prepare(
          `UPDATE profiles
           SET display_name = ?, claimed_at = COALESCE(claimed_at, ?), updated_at = ?
           WHERE user_id = ?`,
        )
        .run(input.displayName.trim(), now, now, invite.userId);
    } else {
      getDb()
        .prepare(
          `UPDATE profiles
           SET claimed_at = COALESCE(claimed_at, ?), updated_at = ?
           WHERE user_id = ?`,
        )
        .run(now, now, invite.userId);
    }

    getDb()
      .prepare('UPDATE user_invites SET used_at = ? WHERE id = ?')
      .run(now, invite.id);
  });

  transaction();
  return getSessionSummary(invite.userId);
}

export function isUserAdmin(userId: string) {
  return listRoleSlugsForUser(userId).includes('admin');
}

export function getPrivateProfileByUserId(userId: string) {
  const row = getProfileRowByUserId(userId);
  return row ? mapProfileRow(row) : null;
}

export function getPublicProfileByHandle(handle: string, requesterUserId?: string | null) {
  const row = getProfileRowByHandle(handle);
  if (!row) return null;

  const profile = mapProfileRow(row);
  const isOwner = requesterUserId && profile.userId === requesterUserId;

  if (profile.visibility === 'private' && !isOwner) {
    return null;
  }

  if (profile.visibility === 'members' && !requesterUserId && !isOwner) {
    return null;
  }

  if (isOwner) {
    return profile;
  }

  return sanitizePublicProfile(profile, requesterUserId);
}

export function updateProfile(userId: string, input: UpdateProfileInput) {
  const current = getProfileRowByUserId(userId);
  if (!current) {
    return null;
  }

  const nextHandle = input.handle ? normalizeHandle(input.handle) : current.handle;
  const existingHandle = getProfileRowByHandle(nextHandle);

  if (existingHandle && existingHandle.user_id !== userId) {
    throw new Error('HANDLE_TAKEN');
  }

  const updatedAt = new Date().toISOString();

  getDb().transaction(() => {
    getDb()
      .prepare(
        `UPDATE profiles
         SET handle = @handle,
             display_name = @displayName,
             bio = @bio,
             avatar_url = @avatarUrl,
             wallet_address = @walletAddress,
             location = @location,
             links_json = @linksJson,
             contact_json = @contactJson,
             visibility = @visibility,
             visibility_json = @visibilityJson,
             updated_at = @updatedAt
         WHERE user_id = @userId`,
      )
      .run({
        userId,
        handle: nextHandle,
        displayName: input.displayName?.trim() || current.display_name,
        bio: input.bio ?? current.bio,
        avatarUrl: input.avatarUrl ?? current.avatar_url,
        walletAddress: input.walletAddress ?? current.wallet_address,
        location: input.location ?? current.location,
        linksJson: JSON.stringify(input.links ?? parseJsonValue(current.links_json, [])),
        contactJson: JSON.stringify(input.contact ?? parseJsonValue(current.contact_json, {})),
        visibility: input.visibility?.trim() || current.visibility,
        visibilityJson: JSON.stringify(
          normalizeProfileVisibilitySettings(
            input.visibilitySettings ?? parseJsonValue(current.visibility_json, {}),
          ),
        ),
        updatedAt,
      });

    if (input.skillSlugs !== undefined) {
      syncUserSkillSlugs(userId, input.skillSlugs);
    }

    if (input.communityRoleSlugs !== undefined) {
      syncUserCommunityRoleSlugs(userId, input.communityRoleSlugs);
    }
  })();

  return getPrivateProfileByUserId(userId);
}

export function claimCurrentProfile(userId: string) {
  getDb()
    .prepare(
      'UPDATE profiles SET claimed_at = COALESCE(claimed_at, ?), updated_at = ? WHERE user_id = ?',
    )
    .run(new Date().toISOString(), new Date().toISOString(), userId);

  return getPrivateProfileByUserId(userId);
}

export function listMembers(query: MemberQuery, requesterUserId?: string | null) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const clauses = ["(p.visibility = 'public' OR (@requesterUserId IS NOT NULL AND p.visibility = 'members') OR p.user_id = @requesterUserId)"];
  const params: Record<string, string | number | null> = { limit, requesterUserId: requesterUserId ?? null };

  if (query.q) {
    clauses.push('(LOWER(p.handle) LIKE @search OR LOWER(p.display_name) LIKE @search)');
    params.search = `%${query.q.trim().toLowerCase()}%`;
  }

  if (query.skill) {
    clauses.push(`EXISTS (
      SELECT 1
      FROM user_skills us
      INNER JOIN skills_catalog s ON s.id = us.skill_id
      WHERE us.user_id = p.user_id AND s.slug = @skillSlug
    )`);
    params.skillSlug = query.skill;
  }

  if (query.communityRole) {
    clauses.push(`EXISTS (
      SELECT 1
      FROM user_community_roles ucr
      INNER JOIN community_roles_catalog c ON c.id = ucr.community_role_id
      WHERE ucr.user_id = p.user_id AND c.slug = @communityRoleSlug
    )`);
    params.communityRoleSlug = query.communityRole;
  }

  const rows = getDb()
    .prepare(
      `SELECT p.*, COALESCE(points.total_points, 0) AS points_total
       FROM profiles p
       LEFT JOIN (
         SELECT user_id, SUM(delta) AS total_points
         FROM points_ledger
         GROUP BY user_id
       ) points ON points.user_id = p.user_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY points_total DESC, p.display_name ASC
       LIMIT @limit`,
    )
    .all(params) as ProfileRow[];

  return rows.map((row) => {
    const profile = mapProfileRow(row);

    return sanitizePublicProfile(profile, requesterUserId);
  });
}

export function listLeaderboard(limit = 25, requesterUserId?: string | null) {
  const rows = getDb()
    .prepare(
      `SELECT p.user_id, p.handle, p.display_name, p.avatar_url, COALESCE(SUM(pl.delta), 0) AS total_points
       FROM profiles p
       LEFT JOIN points_ledger pl ON pl.user_id = p.user_id
       WHERE (p.visibility = 'public' OR (@requesterUserId IS NOT NULL AND p.visibility = 'members') OR p.user_id = @requesterUserId)
       GROUP BY p.id
       ORDER BY total_points DESC, p.display_name ASC
       LIMIT @limit`,
    )
    .all({ limit, requesterUserId: requesterUserId ?? null }) as Array<{
      user_id: string | null;
      handle: string;
      display_name: string;
      avatar_url: string | null;
      total_points: number;
    }>;

  return rows.map((row) => ({
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    badges: row.user_id ? listBadgesForUser(row.user_id) : [],
    totalPoints: row.total_points,
  }));
}

export function getMyPoints(userId: string) {
  const ledger = getDb()
    .prepare(
      `SELECT id, delta, source_type, source_id, reason, meta_json, created_at
       FROM points_ledger
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    .all(userId) as Array<{
      id: string;
      delta: number;
      source_type: string;
      source_id: string | null;
      reason: string;
      meta_json: string;
      created_at: string;
    }>;

  return {
    totalPoints: pointsTotalForUser(userId),
    ledger: ledger.map((entry) => ({
      id: entry.id,
      delta: entry.delta,
      sourceType: entry.source_type,
      sourceId: entry.source_id,
      reason: entry.reason,
      meta: parseJsonValue<Record<string, unknown>>(entry.meta_json, {}),
      createdAt: entry.created_at,
    })),
  };
}

export function getAdminOverview() {
  ensureHomeModulesSeeded();
  const memberCount = (getDb().prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
  const claimedProfileCount = (
    getDb().prepare('SELECT COUNT(*) AS count FROM profiles WHERE claimed_at IS NOT NULL').get() as { count: number }
  ).count;
  const pendingChangeRequestCount = (
    getDb().prepare("SELECT COUNT(*) AS count FROM admin_change_requests WHERE state = 'pending'").get() as { count: number }
  ).count;
  const enabledHomeModules = (
    getDb().prepare('SELECT COUNT(*) AS count FROM home_modules WHERE enabled = 1').get() as { count: number }
  ).count;

  return {
    memberCount,
    claimedProfileCount,
    pendingChangeRequestCount,
    enabledHomeModules,
  };
}

export function listAdminHomeModules() {
  ensureHomeModulesSeeded();

  const rows = getDb()
    .prepare(
      `SELECT id, type, config_json, enabled, display_order, visibility_role, created_at, updated_at
       FROM home_modules
       ORDER BY display_order ASC, created_at ASC, id ASC`,
    )
    .all() as HomeModuleRow[];

  return rows.map(mapHomeModuleRow);
}

export function listHomeModulesForUser(userId: string) {
  const roleSlugs = new Set(listRoleSlugsForUser(userId));

  return listAdminHomeModules().filter((module) => {
    if (!module.enabled) {
      return false;
    }

    if (!module.visibilityRole) {
      return true;
    }

    return roleSlugs.has(module.visibilityRole);
  });
}

export function updateHomeModules(input: UpdateHomeModuleInput[]) {
  ensureHomeModulesSeeded();

  const currentModules = new Map(listAdminHomeModules().map((module) => [module.id, module]));
  const now = new Date().toISOString();
  const updateModule = getDb().prepare(
    `UPDATE home_modules
     SET config_json = ?,
         enabled = ?,
         display_order = ?,
         visibility_role = ?,
         updated_at = ?
     WHERE id = ?`,
  );

  for (const item of input) {
    const current = currentModules.get(item.id);
    if (!current) {
      continue;
    }

    const nextConfig = item.config ? normalizeHomeModuleConfig(current.type, item.config) : current.config;
    const nextEnabled = typeof item.enabled === 'boolean' ? item.enabled : current.enabled;
    const nextDisplayOrder = Number.isInteger(item.displayOrder) ? item.displayOrder : current.displayOrder;
    const nextVisibilityRole = item.visibilityRole === undefined
      ? current.visibilityRole
      : normalizeText(item.visibilityRole) || null;

    updateModule.run(
      JSON.stringify(nextConfig),
      nextEnabled ? 1 : 0,
      nextDisplayOrder,
      nextVisibilityRole,
      now,
      current.id,
    );
  }

  return listAdminHomeModules();
}

export function listAdminPointsAudit(limit = 200) {
  const rows = getDb()
    .prepare(
      `SELECT
         pl.id,
         pl.user_id,
         pl.delta,
         pl.source_type,
         pl.source_id,
         pl.reason,
         pl.meta_json,
         pl.created_at,
         p.handle AS member_handle,
         p.display_name AS member_display_name,
         acr.title AS source_title
       FROM points_ledger pl
       LEFT JOIN profiles p ON p.user_id = pl.user_id
       LEFT JOIN admin_change_requests acr ON acr.id = pl.source_id AND pl.source_type = 'admin_change_request'
       ORDER BY pl.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
      id: string;
      user_id: string;
      delta: number;
      source_type: string;
      source_id: string | null;
      reason: string;
      meta_json: string;
      created_at: string;
      member_handle: string | null;
      member_display_name: string | null;
      source_title: string | null;
    }>;

  const actorLabelCache = new Map<string, string | null>();

  return rows.map((row) => {
    const meta = parseJsonValue<Record<string, unknown>>(row.meta_json, {});
    const actorUserId = typeof meta.actorUserId === 'string' ? meta.actorUserId : null;

    let actorDisplayName: string | null = null;
    if (actorUserId) {
      if (actorLabelCache.has(actorUserId)) {
        actorDisplayName = actorLabelCache.get(actorUserId) ?? null;
      } else {
        const actor = getSessionSummary(actorUserId);
        actorDisplayName = actor?.displayName || actor?.handle || actor?.email || null;
        actorLabelCache.set(actorUserId, actorDisplayName);
      }
    }

    return {
      id: row.id,
      userId: row.user_id,
      memberHandle: row.member_handle,
      memberDisplayName: row.member_display_name,
      delta: row.delta,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      reason: row.reason,
      meta,
      actorUserId,
      actorDisplayName,
      createdAt: row.created_at,
    } satisfies AdminPointsAuditEntry;
  });
}

export function listAdminUsers(limit = 100) {
  const rows = getDb()
    .prepare(
      `SELECT
         u.id,
         u.email,
         u.is_banned,
         u.is_seeded,
         u.last_seen_at,
         u.created_at,
         p.handle,
         p.display_name,
         p.claimed_at,
         COALESCE(points.total_points, 0) AS total_points
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN (
         SELECT user_id, SUM(delta) AS total_points
         FROM points_ledger
         GROUP BY user_id
       ) points ON points.user_id = u.id
       ORDER BY u.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
      id: string;
      email: string | null;
      is_banned: number;
      is_seeded: number;
      last_seen_at: string | null;
      created_at: string;
      handle: string | null;
      display_name: string | null;
      claimed_at: string | null;
      total_points: number;
    }>;

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    handle: row.handle,
    displayName: row.display_name,
    isBanned: Boolean(row.is_banned),
    isSeeded: Boolean(row.is_seeded),
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    pointsTotal: row.total_points,
    roleSlugs: listRoleSlugsForUser(row.id),
  } satisfies AdminUserSummary));
}

function normalizeAdminRoleSlugs(input: readonly string[]) {
  const allowed = new Set(['admin', 'moderator', 'member']);
  const next = Array.from(new Set(input.map((role) => role.trim()).filter((role) => allowed.has(role))));
  return next.length ? next : ['member'];
}

function ensureStandardAppRoles() {
  const db = getDb();
  const now = new Date().toISOString();
  const upsertRole = db.prepare(
    `INSERT INTO roles (slug, label, description, created_at, updated_at)
     VALUES (@slug, @label, @description, @createdAt, @updatedAt)
     ON CONFLICT(slug) DO UPDATE SET
       label = excluded.label,
       description = excluded.description,
       updated_at = excluded.updated_at`,
  );

  for (const role of [
    { slug: 'admin', label: 'Admin', description: 'Full administrative access.' },
    { slug: 'moderator', label: 'Moderator', description: 'Moderation and review access.' },
    { slug: 'member', label: 'Member', description: 'Standard authenticated member access.' },
  ]) {
    upsertRole.run({ ...role, createdAt: now, updatedAt: now });
  }
}

function slugFromEmail(email: string) {
  return email
    .split('@')[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'member';
}

function uniqueProfileHandle(base: string, userId: string) {
  const normalized = base || 'member';
  const existing = getProfileRowByHandle(normalized);
  if (!existing) return normalized;
  return `${normalized}-${userId.slice(0, 8)}`;
}

export function setUserRoleSlugs(userId: string, roleSlugs: readonly string[]) {
  const db = getDb();
  const normalized = normalizeAdminRoleSlugs(roleSlugs);
  const now = new Date().toISOString();
  ensureStandardAppRoles();
  const placeholders = normalized.map(() => '?').join(', ');
  const roleRows = db
    .prepare(`SELECT id, slug FROM roles WHERE slug IN (${placeholders})`)
    .all(...normalized) as Array<{ id: number; slug: string }>;

  if (roleRows.length !== normalized.length) {
    throw new Error('UNKNOWN_ROLE');
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId);
    const insert = db.prepare(
      `INSERT INTO user_roles (user_id, role_id, created_at)
       VALUES (?, ?, ?)`,
    );
    for (const role of roleRows) {
      insert.run(userId, role.id, now);
    }
    db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(now, userId);
  });

  transaction();
  return getSessionSummary(userId);
}

export function createAdminManagedUser(input: {
  email: string;
  displayName?: string | null;
  roleSlugs?: string[];
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const email = normalizeEmail(input.email);
  if (!email || !email.includes('@')) {
    throw new Error('INVALID_EMAIL');
  }

  const existing = getUserByEmail(email);
  if (existing) {
    const updated = setUserRoleSlugs(existing.id, input.roleSlugs ?? ['member']);
    return updated;
  }

  const userId = randomUUID();
  const handle = uniqueProfileHandle(slugFromEmail(email), userId);
  const displayName = input.displayName?.trim() || handle;

  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at, updated_at, last_seen_at, is_seeded)
       VALUES (?, ?, NULL, ?, ?, NULL, 0)`,
    ).run(userId, email, now, now);

    db.prepare(
      `INSERT INTO profiles (
         id, user_id, handle, display_name, email, links_json, skills_json, cohorts_json,
         contact_json, visibility, visibility_json, claimed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, '[]', '[]', '[]', '{}', 'private', '{}', NULL, ?, ?)`,
    ).run(randomUUID(), userId, handle, displayName, email, now, now);
  });

  transaction();
  return setUserRoleSlugs(userId, input.roleSlugs ?? ['member']);
}

export function listAdminChangeRequests(state?: string) {
  const params: Array<string> = [];
  let sql = `SELECT
      acr.id,
      acr.request_type,
      acr.title,
      acr.state,
      acr.priority,
      acr.payload_json,
      acr.requested_by_user_id,
      requester.display_name AS requested_by_display_name,
      acr.assigned_to_user_id,
      assignee.display_name AS assigned_to_display_name,
      acr.resolution_note,
      acr.created_at,
      acr.updated_at,
      acr.resolved_at
    FROM admin_change_requests acr
    LEFT JOIN profiles requester ON requester.user_id = acr.requested_by_user_id
    LEFT JOIN profiles assignee ON assignee.user_id = acr.assigned_to_user_id`;

  if (state) {
    sql += ' WHERE acr.state = ?';
    params.push(state);
  }

  sql += ' ORDER BY CASE acr.state WHEN \'pending\' THEN 0 WHEN \'opened\' THEN 1 ELSE 2 END, acr.created_at DESC';

  const rows = getDb().prepare(sql).all(...params) as Array<{
    id: string;
    request_type: string;
    title: string;
    state: string;
    priority: string;
    payload_json: string;
    requested_by_user_id: string | null;
    requested_by_display_name: string | null;
    assigned_to_user_id: string | null;
    assigned_to_display_name: string | null;
    resolution_note: string | null;
    created_at: string;
    updated_at: string;
    resolved_at: string | null;
  }>;

  return rows.map(parseChangeRequestRow);
}

export function listTargetApps() {
  const rows = getDb()
    .prepare(
      `SELECT
         id,
         slug,
         name,
         description,
         repo_url,
         repo_provider,
         default_branch,
         framework,
         deploy_backend,
         deploy_config_json,
         agent_enabled,
         created_at,
         updated_at
       FROM target_apps
       ORDER BY agent_enabled DESC, name ASC`,
    )
    .all() as Array<{
      id: string;
      slug: string;
      name: string;
      description: string | null;
      repo_url: string | null;
      repo_provider: string | null;
      default_branch: string;
      framework: string | null;
      deploy_backend: string;
      deploy_config_json: string;
      agent_enabled: number;
      created_at: string;
      updated_at: string;
    }>;

  return rows.map(parseTargetAppRow);
}

export function getTargetApp(targetAppId: string) {
  const row = getDb()
    .prepare(
      `SELECT
         id,
         slug,
         name,
         description,
         repo_url,
         repo_provider,
         default_branch,
         framework,
         deploy_backend,
         deploy_config_json,
         agent_enabled,
         created_at,
         updated_at
       FROM target_apps
       WHERE id = ?`,
    )
    .get(targetAppId) as
    | {
        id: string;
        slug: string;
        name: string;
        description: string | null;
        repo_url: string | null;
        repo_provider: string | null;
        default_branch: string;
        framework: string | null;
        deploy_backend: string;
        deploy_config_json: string;
        agent_enabled: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  return row ? parseTargetAppRow(row) : null;
}

export function createTargetApp(input: CreateTargetAppInput) {
  const now = new Date().toISOString();
  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO target_apps (
         id, slug, name, description, repo_url, repo_provider, default_branch,
         framework, deploy_backend, deploy_config_json, agent_enabled, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.slug,
      input.name,
      input.description ?? null,
      input.repoUrl ?? null,
      input.repoProvider ?? null,
      input.defaultBranch ?? 'main',
      input.framework ?? null,
      input.deployBackend,
      JSON.stringify(input.deployConfig ?? {}),
      input.agentEnabled === false ? 0 : 1,
      now,
      now,
    );

  return getTargetApp(id);
}

export function updateTargetApp(targetAppId: string, input: UpdateTargetAppInput) {
  const current = getTargetApp(targetAppId);
  if (!current) {
    return null;
  }

  const name = normalizeText(input.name) || current.name;
  const defaultBranch = normalizeText(input.defaultBranch) || current.defaultBranch || 'main';
  const now = new Date().toISOString();

  getDb()
    .prepare(
      `UPDATE target_apps
       SET name = ?,
           description = ?,
           repo_url = ?,
           default_branch = ?,
           agent_enabled = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      name,
      input.description !== undefined ? input.description : current.description,
      input.repoUrl !== undefined ? input.repoUrl : current.repoUrl,
      defaultBranch,
      input.agentEnabled !== undefined ? (input.agentEnabled ? 1 : 0) : current.agentEnabled ? 1 : 0,
      now,
      targetAppId,
    );

  return getTargetApp(targetAppId);
}

export function listTargetEnvironments(targetAppId?: string) {
  const params: Array<string> = [];
  let sql = `SELECT
      te.id,
      te.target_app_id,
      ta.slug AS target_app_slug,
      te.slug,
      te.name,
      te.kind,
      te.branch,
      te.base_url,
      te.deploy_backend,
      te.deploy_config_json,
      te.agent_writable,
      te.auto_deploy_enabled,
      te.human_review_required,
      te.is_default_for_agent,
      te.created_at,
      te.updated_at
    FROM target_environments te
    LEFT JOIN target_apps ta ON ta.id = te.target_app_id`;

  if (targetAppId) {
    sql += ' WHERE te.target_app_id = ?';
    params.push(targetAppId);
  }

  sql += ' ORDER BY ta.name ASC, te.is_default_for_agent DESC, te.name ASC';

  const rows = getDb().prepare(sql).all(...params) as Array<{
    id: string;
    target_app_id: string | null;
    target_app_slug: string | null;
    slug: string;
    name: string;
    kind: string;
    branch: string | null;
    base_url: string | null;
    deploy_backend: string;
    deploy_config_json: string;
    agent_writable: number;
    auto_deploy_enabled: number;
    human_review_required: number;
    is_default_for_agent: number;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map(parseTargetEnvironmentRow);
}

export function createTargetEnvironment(input: CreateTargetEnvironmentInput) {
  const now = new Date().toISOString();
  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO target_environments (
         id, target_app_id, slug, name, kind, branch, base_url, deploy_backend,
         deploy_config_json, agent_writable, auto_deploy_enabled, human_review_required,
         is_default_for_agent, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.targetAppId,
      input.slug,
      input.name,
      input.kind,
      input.branch ?? null,
      input.baseUrl ?? null,
      input.deployBackend,
      JSON.stringify(input.deployConfig ?? {}),
      input.agentWritable ? 1 : 0,
      input.autoDeployEnabled ? 1 : 0,
      input.humanReviewRequired === false ? 0 : 1,
      input.isDefaultForAgent ? 1 : 0,
      now,
      now,
    );

  return listTargetEnvironments(input.targetAppId).find((environment) => environment.id === id) ?? null;
}

export function updateTargetEnvironment(targetEnvironmentId: string, input: UpdateTargetEnvironmentInput) {
  const current = getTargetEnvironment(targetEnvironmentId);
  if (!current) {
    return null;
  }

  const now = new Date().toISOString();
  const branch = input.branch !== undefined ? normalizeText(input.branch) || null : current.branch;
  const db = getDb();

  db.transaction(() => {
    if (input.isDefaultForAgent === true && current.targetAppId) {
      db.prepare(
        `UPDATE target_environments
         SET is_default_for_agent = 0,
             updated_at = ?
         WHERE target_app_id = ?
           AND id != ?`,
      ).run(now, current.targetAppId, targetEnvironmentId);
    }

    db.prepare(
      `UPDATE target_environments
       SET branch = ?,
           agent_writable = ?,
           is_default_for_agent = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      branch,
      input.agentWritable !== undefined ? (input.agentWritable ? 1 : 0) : current.agentWritable ? 1 : 0,
      input.isDefaultForAgent !== undefined
        ? (input.isDefaultForAgent ? 1 : 0)
        : current.isDefaultForAgent ? 1 : 0,
      now,
      targetEnvironmentId,
    );
  })();

  return getTargetEnvironment(targetEnvironmentId);
}

export function getTargetEnvironment(targetEnvironmentId: string) {
  const row = getDb()
    .prepare(
      `SELECT
         te.id,
         te.target_app_id,
         ta.slug AS target_app_slug,
         te.slug,
         te.name,
         te.kind,
         te.branch,
         te.base_url,
         te.deploy_backend,
         te.deploy_config_json,
         te.agent_writable,
         te.auto_deploy_enabled,
         te.human_review_required,
         te.is_default_for_agent,
         te.created_at,
         te.updated_at
       FROM target_environments te
       LEFT JOIN target_apps ta ON ta.id = te.target_app_id
       WHERE te.id = ?`,
    )
    .get(targetEnvironmentId) as
    | {
        id: string;
        target_app_id: string | null;
        target_app_slug: string | null;
        slug: string;
        name: string;
        kind: string;
        branch: string | null;
        base_url: string | null;
        deploy_backend: string;
        deploy_config_json: string;
        agent_writable: number;
        auto_deploy_enabled: number;
        human_review_required: number;
        is_default_for_agent: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  return row ? parseTargetEnvironmentRow(row) : null;
}

export function getDefaultTargetEnvironmentForApp(targetAppId: string) {
  const row = getDb()
    .prepare(
      `SELECT
         te.id,
         te.target_app_id,
         ta.slug AS target_app_slug,
         te.slug,
         te.name,
         te.kind,
         te.branch,
         te.base_url,
         te.deploy_backend,
         te.deploy_config_json,
         te.agent_writable,
         te.auto_deploy_enabled,
         te.human_review_required,
         te.is_default_for_agent,
         te.created_at,
         te.updated_at
       FROM target_environments te
       LEFT JOIN target_apps ta ON ta.id = te.target_app_id
       WHERE te.target_app_id = ?
         AND te.is_default_for_agent = 1
       ORDER BY
         CASE te.kind
           WHEN 'staging' THEN 0
           WHEN 'preview' THEN 1
           WHEN 'development' THEN 2
           WHEN 'production' THEN 3
           ELSE 4
         END,
         te.created_at ASC
       LIMIT 1`,
    )
    .get(targetAppId) as
    | {
        id: string;
        target_app_id: string | null;
        target_app_slug: string | null;
        slug: string;
        name: string;
        kind: string;
        branch: string | null;
        base_url: string | null;
        deploy_backend: string;
        deploy_config_json: string;
        agent_writable: number;
        auto_deploy_enabled: number;
        human_review_required: number;
        is_default_for_agent: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  return row ? parseTargetEnvironmentRow(row) : null;
}

export function listChangeRequests(input: ListChangeRequestsInput = {}) {
  const params: Array<string> = [];
  let sql = `SELECT
      cr.id,
      cr.request_number,
      cr.workflow_key,
      cr.title,
      cr.description,
      cr.request_type,
      cr.priority,
      cr.source,
      cr.requested_by_user_id,
      requester.display_name AS requested_by_display_name,
      cr.target_app_id,
      ta.slug AS target_app_slug,
      ta.name AS target_app_name,
      cr.target_environment_id,
      te.slug AS target_environment_slug,
      te.name AS target_environment_name,
      wr.current_step_key AS current_workflow_step_key,
      wr.status AS workflow_run_status,
      cr.triage_summary,
      cr.estimated_human_hours,
      cr.acceptance_criteria_json,
      cr.constraints_json,
      cr.attachments_json,
      cr.agent_recommendation,
      cr.review_notes,
      cr.resolution_summary,
      cr.created_at,
      cr.updated_at,
      cr.triaged_at,
      cr.approved_for_work_at,
      cr.completed_at,
      cr.closed_at
    FROM change_requests cr
    LEFT JOIN profiles requester ON requester.user_id = cr.requested_by_user_id
    LEFT JOIN target_apps ta ON ta.id = cr.target_app_id
    LEFT JOIN target_environments te ON te.id = cr.target_environment_id
    LEFT JOIN workflow_runs wr ON wr.request_id = cr.id`;

  const conditions: string[] = [];
  if (input.targetAppId) {
    conditions.push('cr.target_app_id = ?');
    params.push(input.targetAppId);
  }
  if (input.source) {
    conditions.push('cr.source = ?');
    params.push(input.source);
  }
  if (input.platform) {
    conditions.push('EXISTS (SELECT 1 FROM request_origins ro WHERE ro.request_id = cr.id AND ro.platform = ?)');
    params.push(input.platform);
  }
  if (input.originTargetId) {
    conditions.push('EXISTS (SELECT 1 FROM request_origins ro WHERE ro.request_id = cr.id AND ro.target_id = ?)');
    params.push(input.originTargetId);
  }
  if (input.interactionProfileKey) {
    conditions.push('EXISTS (SELECT 1 FROM request_origins ro WHERE ro.request_id = cr.id AND ro.interaction_profile_key = ?)');
    params.push(input.interactionProfileKey);
  }
  if (input.originActor) {
    conditions.push('EXISTS (SELECT 1 FROM request_origins ro WHERE ro.request_id = cr.id AND COALESCE(ro.actor_id, ro.actor_type, \'unknown\') = ?)');
    params.push(input.originActor);
  }
  if (input.query) {
    conditions.push(`(
      CAST(cr.request_number AS TEXT) LIKE ? OR lower(cr.title) LIKE ? OR lower(cr.description) LIKE ?
      OR EXISTS (
        SELECT 1 FROM request_origins ro WHERE ro.request_id = cr.id AND lower(
          COALESCE(ro.target_name, '') || ' ' || COALESCE(ro.target_id, '') || ' '
          || COALESCE(ro.interaction_profile_key, '') || ' ' || COALESCE(ro.actor_display_name, '') || ' '
          || COALESCE(ro.actor_id, '') || ' ' || COALESCE(ro.raw_source, '')
        ) LIKE ?
      )
    )`);
    const query = `%${input.query.toLocaleLowerCase()}%`;
    params.push(query, query, query, query);
  }
  if (input.openOnly) {
    conditions.push("COALESCE(wr.status, 'active') != 'completed'");
    conditions.push('cr.completed_at IS NULL');
    conditions.push('cr.closed_at IS NULL');
  }
  if (conditions.length) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  sql += ' ORDER BY cr.created_at DESC';
  if (input.limit && Number.isFinite(input.limit) && input.limit > 0) {
    sql += ' LIMIT ?';
    params.push(String(Math.trunc(input.limit)));
  }

  const rows = getDb().prepare(sql).all(...params) as Array<{
    id: string;
    request_number: number;
    workflow_key: string;
    title: string;
    description: string;
    request_type: string;
    priority: string;
    source: string;
    requested_by_user_id: string | null;
    requested_by_display_name: string | null;
    target_app_id: string | null;
    target_app_slug: string | null;
    target_app_name: string | null;
    target_environment_id: string | null;
    target_environment_slug: string | null;
    target_environment_name: string | null;
    current_workflow_step_key: string | null;
    workflow_run_status: string | null;
    triage_summary: string | null;
    estimated_human_hours: number | null;
    acceptance_criteria_json: string | null;
    constraints_json: string | null;
    attachments_json: string | null;
    agent_recommendation: string | null;
    review_notes: string | null;
    resolution_summary: string | null;
    created_at: string;
    updated_at: string;
    triaged_at: string | null;
    approved_for_work_at: string | null;
    completed_at: string | null;
    closed_at: string | null;
  }>;

  const requests = rows.map(parseTrackedChangeRequestRow);
  const attentionByRequestId = listWorkflowAttentionForRequests(requests);
  const originsByRequestId = listRequestOrigins(requests.map((request) => request.id));
  return requests.map((request) => withRequestOrigin(
    withWorkflowAttention(request, attentionByRequestId.get(request.id) ?? null),
    originsByRequestId.get(request.id) ?? null,
  ));
}

export function getNextQueuedChangeRequest(input: ListChangeRequestsInput = {}) {
  const params: Array<string> = [];
  const activeAgentRunStatuses = ['queued', 'running'];

  let sql = `SELECT
      cr.id,
      cr.request_number,
      cr.workflow_key,
      cr.title,
      cr.description,
      cr.request_type,
      cr.priority,
      cr.source,
      cr.requested_by_user_id,
      requester.display_name AS requested_by_display_name,
      cr.target_app_id,
      ta.slug AS target_app_slug,
      ta.name AS target_app_name,
      cr.target_environment_id,
      te.slug AS target_environment_slug,
      te.name AS target_environment_name,
      wr.current_step_key AS current_workflow_step_key,
      wr.status AS workflow_run_status,
      cr.triage_summary,
      cr.estimated_human_hours,
      cr.acceptance_criteria_json,
      cr.constraints_json,
      cr.attachments_json,
      cr.agent_recommendation,
      cr.review_notes,
      cr.resolution_summary,
      cr.created_at,
      cr.updated_at,
      cr.triaged_at,
      cr.approved_for_work_at,
      cr.completed_at,
      cr.closed_at
    FROM change_requests cr
    LEFT JOIN profiles requester ON requester.user_id = cr.requested_by_user_id
    LEFT JOIN target_apps ta ON ta.id = cr.target_app_id
    LEFT JOIN target_environments te ON te.id = cr.target_environment_id
    LEFT JOIN workflow_runs wr ON wr.request_id = cr.id
    WHERE (cr.target_app_id IS NULL OR ta.agent_enabled = 1)
      AND COALESCE(wr.status, 'active') != 'completed'
      AND NOT EXISTS (
        SELECT 1
        FROM agent_runs ar
        WHERE ar.request_id = cr.id
          AND ar.status IN (${activeAgentRunStatuses.map(() => '?').join(', ')})
      )`;

  params.push(...activeAgentRunStatuses);

  if (input.targetAppId) {
    sql += ' AND cr.target_app_id = ?';
    params.push(input.targetAppId);
  }

  sql += `
    ORDER BY
      CASE cr.priority
        WHEN 'urgent' THEN 0
        WHEN 'high' THEN 1
        WHEN 'normal' THEN 2
        WHEN 'low' THEN 3
        ELSE 4
      END,
      COALESCE(cr.approved_for_work_at, cr.triaged_at, cr.created_at) ASC,
      cr.request_number ASC
    LIMIT 1`;

  const row = getDb().prepare(sql).get(...params) as
    | {
        id: string;
        request_number: number;
        workflow_key: string;
        title: string;
        description: string;
        request_type: string;
        priority: string;
        source: string;
        requested_by_user_id: string | null;
        requested_by_display_name: string | null;
        target_app_id: string | null;
        target_app_slug: string | null;
        target_app_name: string | null;
        target_environment_id: string | null;
        target_environment_slug: string | null;
        target_environment_name: string | null;
        current_workflow_step_key: string | null;
        workflow_run_status: string | null;
        triage_summary: string | null;
        estimated_human_hours: number | null;
        acceptance_criteria_json: string | null;
        constraints_json: string | null;
        attachments_json: string | null;
        agent_recommendation: string | null;
        review_notes: string | null;
        resolution_summary: string | null;
        created_at: string;
        updated_at: string;
        triaged_at: string | null;
        approved_for_work_at: string | null;
        completed_at: string | null;
        closed_at: string | null;
      }
    | undefined;

  return row ? withRequestOrigin(withWorkflowAttention(parseTrackedChangeRequestRow(row))) : null;
}

export function getCurrentActiveChangeRequest(input: ListChangeRequestsInput = {}) {
  const params: Array<string> = [];
  const activeAgentRunStatuses = ['queued', 'running'];

  let sql = `SELECT
      cr.id,
      cr.request_number,
      cr.workflow_key,
      cr.title,
      cr.description,
      cr.request_type,
      cr.priority,
      cr.source,
      cr.requested_by_user_id,
      requester.display_name AS requested_by_display_name,
      cr.target_app_id,
      ta.slug AS target_app_slug,
      ta.name AS target_app_name,
      cr.target_environment_id,
      te.slug AS target_environment_slug,
      te.name AS target_environment_name,
      wr.current_step_key AS current_workflow_step_key,
      wr.status AS workflow_run_status,
      cr.triage_summary,
      cr.estimated_human_hours,
      cr.acceptance_criteria_json,
      cr.constraints_json,
      cr.attachments_json,
      cr.agent_recommendation,
      cr.review_notes,
      cr.resolution_summary,
      cr.created_at,
      cr.updated_at,
      cr.triaged_at,
      cr.approved_for_work_at,
      cr.completed_at,
      cr.closed_at
    FROM change_requests cr
    LEFT JOIN profiles requester ON requester.user_id = cr.requested_by_user_id
    LEFT JOIN target_apps ta ON ta.id = cr.target_app_id
    LEFT JOIN target_environments te ON te.id = cr.target_environment_id
    LEFT JOIN workflow_runs wr ON wr.request_id = cr.id
    WHERE (cr.target_app_id IS NULL OR ta.agent_enabled = 1)
      AND COALESCE(wr.status, 'active') != 'completed'
      AND EXISTS (
        SELECT 1
        FROM agent_runs ar
        WHERE ar.request_id = cr.id
          AND ar.status IN (${activeAgentRunStatuses.map(() => '?').join(', ')})
      )`;

  params.push(...activeAgentRunStatuses);

  if (input.targetAppId) {
    sql += ' AND cr.target_app_id = ?';
    params.push(input.targetAppId);
  }

  sql += `
    ORDER BY
      COALESCE(
        (
          SELECT MAX(COALESCE(ar.started_at, ar.created_at))
          FROM agent_runs ar
          WHERE ar.request_id = cr.id
            AND ar.status IN (${activeAgentRunStatuses.map(() => '?').join(', ')})
        ),
        cr.updated_at
      ) DESC,
      cr.request_number ASC
    LIMIT 1`;

  params.push(...activeAgentRunStatuses);

  const row = getDb().prepare(sql).get(...params) as Parameters<typeof parseTrackedChangeRequestRow>[0] | undefined;
  return row ? withRequestOrigin(withWorkflowAttention(parseTrackedChangeRequestRow(row))) : null;
}

export function getChangeRequest(changeRequestId: string) {
  const row = getDb()
    .prepare(
      `SELECT
         cr.id,
         cr.request_number,
         cr.workflow_key,
         cr.title,
         cr.description,
         cr.request_type,
         cr.priority,
         cr.source,
         cr.requested_by_user_id,
         requester.display_name AS requested_by_display_name,
         cr.target_app_id,
         ta.slug AS target_app_slug,
         ta.name AS target_app_name,
         cr.target_environment_id,
         te.slug AS target_environment_slug,
         te.name AS target_environment_name,
         wr.current_step_key AS current_workflow_step_key,
         wr.status AS workflow_run_status,
         cr.triage_summary,
         cr.estimated_human_hours,
         cr.acceptance_criteria_json,
         cr.constraints_json,
         cr.attachments_json,
         cr.agent_recommendation,
         cr.review_notes,
         cr.resolution_summary,
         cr.created_at,
         cr.updated_at,
         cr.triaged_at,
         cr.approved_for_work_at,
         cr.completed_at,
         cr.closed_at
       FROM change_requests cr
       LEFT JOIN profiles requester ON requester.user_id = cr.requested_by_user_id
       LEFT JOIN target_apps ta ON ta.id = cr.target_app_id
       LEFT JOIN target_environments te ON te.id = cr.target_environment_id
       LEFT JOIN workflow_runs wr ON wr.request_id = cr.id
       WHERE cr.id = ?`,
    )
    .get(changeRequestId) as
    | {
        id: string;
        request_number: number;
        workflow_key: string;
        title: string;
        description: string;
        request_type: string;
        priority: string;
        source: string;
        requested_by_user_id: string | null;
        requested_by_display_name: string | null;
        target_app_id: string | null;
        target_app_slug: string | null;
        target_app_name: string | null;
        target_environment_id: string | null;
        target_environment_slug: string | null;
        target_environment_name: string | null;
        triage_summary: string | null;
        estimated_human_hours: number | null;
        acceptance_criteria_json: string | null;
        constraints_json: string | null;
        attachments_json: string | null;
        agent_recommendation: string | null;
        review_notes: string | null;
        resolution_summary: string | null;
        created_at: string;
        updated_at: string;
        triaged_at: string | null;
        approved_for_work_at: string | null;
        completed_at: string | null;
        closed_at: string | null;
      }
    | undefined;

  return row ? withRequestOrigin(withWorkflowAttention(parseTrackedChangeRequestRow(row))) : null;
}

export function getChangeRequestByNumber(requestNumber: number) {
  const row = getDb()
    .prepare('SELECT id FROM change_requests WHERE request_number = ?')
    .get(requestNumber) as { id: string } | undefined;

  return row ? getChangeRequest(row.id) : null;
}

function getNextChangeRequestNumber() {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(request_number), 0) + 1 AS next_number FROM change_requests')
    .get() as { next_number: number };

  return row.next_number;
}

export function createChangeRequest(input: CreateChangeRequestInput) {
  const now = new Date().toISOString();
  const id = randomUUID();
  const workflowKey = normalizeText(input.workflowKey);
  if (!workflowKey) throw new Error('WORKFLOW_KEY_REQUIRED');
  const workflow = getWorkflowByKey(workflowKey);
  if (!workflow) {
    throw new Error('WORKFLOW_NOT_FOUND');
  }
  if (!workflow.enabled) {
    throw new Error('WORKFLOW_DISABLED');
  }
  if (input.targetAppId) {
    const targetApp = getTargetApp(input.targetAppId);
    if (!targetApp) {
      throw new Error('TARGET_APP_NOT_FOUND');
    }
    if (!targetApp.agentEnabled) {
      throw new Error('TARGET_APP_INACTIVE');
    }
  }
  const db = getDb();
  const origin = resolveRequestOriginSnapshot({
    sourceSessionId: input.sourceSessionId,
    sourceMessageId: input.sourceMessageId,
    rawSource: input.source ?? 'manual',
    requestedByUserId: input.requestedByUserId,
    capturedAt: now,
  }, db);
  db.transaction(() => {
    db
      .prepare(
        `INSERT INTO change_requests (
           id, request_number, workflow_key, title, description, request_type, priority, source,
           requested_by_user_id, target_app_id, target_environment_id, triage_summary,
           estimated_human_hours, acceptance_criteria_json, constraints_json, attachments_json, agent_recommendation,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        getNextChangeRequestNumber(),
        workflowKey,
        input.title,
        input.description,
        input.requestType,
        input.priority ?? 'normal',
        input.source ?? 'manual',
        input.requestedByUserId ?? null,
        input.targetAppId ?? null,
        input.targetEnvironmentId ?? null,
        input.triageSummary ?? null,
        input.estimatedHumanHours ?? null,
        JSON.stringify(input.acceptanceCriteria ?? []),
        JSON.stringify(input.constraints ?? {}),
        JSON.stringify(input.attachments ?? []),
        input.agentRecommendation ?? null,
        now,
        now,
      );

    insertRequestOrigin(id, origin, db);
    if (origin.sourceSessionId) {
      db.prepare(`
        UPDATE agent_sessions
        SET linked_change_request_id = COALESCE(linked_change_request_id, ?), updated_at = ?
        WHERE id = ?
      `).run(id, now, origin.sourceSessionId);
    }

    ensureWorkflowRunForRequest({
      requestId: id,
      workflowKey,
      currentStepKey: workflowEntrypoint(workflow),
    });
  })();

  return getChangeRequest(id);
}

export function updateChangeRequest(changeRequestId: string, input: UpdateChangeRequestInput) {
  const current = getChangeRequest(changeRequestId);
  if (!current) {
    return null;
  }

  const now = new Date().toISOString();
  const workflow = getWorkflowByKey(current.workflowKey);
  const lifecycleStepKey =
    normalizeText(input.workflowStepKey) ||
    getWorkflowRunForRequest(changeRequestId)?.currentStepKey ||
    workflowEntrypoint(workflow);
  const terminalForTimeline = workflowStepIsTerminal(workflow, lifecycleStepKey);

  getDb()
    .prepare(
      `UPDATE change_requests
       SET priority = ?,
           target_environment_id = ?,
           triage_summary = ?,
           estimated_human_hours = ?,
           review_notes = ?,
           resolution_summary = ?,
           agent_recommendation = ?,
           triaged_at = COALESCE(triaged_at, ?),
           approved_for_work_at = CASE
             WHEN ? THEN COALESCE(approved_for_work_at, ?)
             ELSE approved_for_work_at
           END,
           completed_at = CASE
             WHEN ? THEN COALESCE(completed_at, ?)
             ELSE completed_at
           END,
           closed_at = CASE
             WHEN ?
               THEN COALESCE(closed_at, ?)
             ELSE closed_at
           END,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.priority ?? current.priority,
      input.targetEnvironmentId !== undefined ? input.targetEnvironmentId : current.targetEnvironmentId,
      input.triageSummary !== undefined ? input.triageSummary : current.triageSummary,
      input.estimatedHumanHours !== undefined ? input.estimatedHumanHours : current.estimatedHumanHours,
      input.reviewNotes !== undefined ? input.reviewNotes : current.reviewNotes,
      input.resolutionSummary !== undefined ? input.resolutionSummary : current.resolutionSummary,
      input.agentRecommendation !== undefined ? input.agentRecommendation : current.agentRecommendation,
      now,
      input.workflowStepKey ? 1 : 0,
      now,
      terminalForTimeline ? 1 : 0,
      now,
      terminalForTimeline ? 1 : 0,
      now,
      now,
      changeRequestId,
    );

  const updated = getChangeRequest(changeRequestId);
  return updated;
}

export function clearChangeRequestClosedAt(changeRequestId: string) {
  const now = new Date().toISOString();
  const db = getDb();

  db.transaction(() => {
    db.prepare(
      `UPDATE change_requests
       SET closed_at = NULL,
           completed_at = NULL,
           updated_at = ?
       WHERE id = ?`,
    ).run(now, changeRequestId);

    db.prepare(
      `UPDATE workflow_runs
       SET status = 'active',
           completed_at = NULL,
           updated_at = ?
       WHERE request_id = ?
         AND status = 'completed'`,
    ).run(now, changeRequestId);
  })();

  return getChangeRequest(changeRequestId);
}

export function listChangeRequestExecutions(changeRequestId: string) {
  const rows = getDb()
    .prepare(
      `SELECT
         cre.id,
         cre.change_request_id,
         cre.target_environment_id,
         te.slug AS target_environment_slug,
         cre.status,
         cre.actor_type,
         cre.branch_name,
         cre.commit_sha,
         cre.deploy_url,
         cre.adapter_kind,
         cre.adapter_status,
         cre.summary,
         cre.error_message,
         cre.meta_json,
         cre.created_at,
         cre.updated_at,
         cre.started_at,
         cre.finished_at
       FROM change_request_executions cre
       LEFT JOIN target_environments te ON te.id = cre.target_environment_id
       WHERE cre.change_request_id = ?
       ORDER BY cre.created_at DESC`,
    )
    .all(changeRequestId) as Array<{
      id: string;
      change_request_id: string;
      target_environment_id: string | null;
      target_environment_slug: string | null;
      status: string;
      actor_type: string;
      branch_name: string | null;
      commit_sha: string | null;
      deploy_url: string | null;
      adapter_kind: string | null;
      adapter_status: string | null;
      summary: string | null;
      error_message: string | null;
      meta_json: string;
      created_at: string;
      updated_at: string;
      started_at: string | null;
      finished_at: string | null;
    }>;

  return rows.map(parseChangeRequestExecutionRow);
}

export function getChangeRequestExecution(executionId: string) {
  const row = getDb()
    .prepare(
      `SELECT
         cre.id,
         cre.change_request_id,
         cre.target_environment_id,
         te.slug AS target_environment_slug,
         cre.status,
         cre.actor_type,
         cre.branch_name,
         cre.commit_sha,
         cre.deploy_url,
         cre.adapter_kind,
         cre.adapter_status,
         cre.summary,
         cre.error_message,
         cre.meta_json,
         cre.created_at,
         cre.updated_at,
         cre.started_at,
         cre.finished_at
       FROM change_request_executions cre
       LEFT JOIN target_environments te ON te.id = cre.target_environment_id
       WHERE cre.id = ?`,
    )
    .get(executionId) as
    | {
        id: string;
        change_request_id: string;
        target_environment_id: string | null;
        target_environment_slug: string | null;
        status: string;
        actor_type: string;
        branch_name: string | null;
        commit_sha: string | null;
        deploy_url: string | null;
        adapter_kind: string | null;
        adapter_status: string | null;
        summary: string | null;
        error_message: string | null;
        meta_json: string;
        created_at: string;
        updated_at: string;
        started_at: string | null;
        finished_at: string | null;
      }
    | undefined;

  return row ? parseChangeRequestExecutionRow(row) : null;
}

export function getAgentSession(sessionId: string) {
  const row = getDb()
    .prepare(
      `SELECT
         id,
         source,
         status,
         title,
         discord_guild_id,
         discord_channel_id,
         discord_thread_id,
         linked_change_request_id,
         linked_target_environment_id,
         meta_json,
         created_by_user_id,
         last_message_at,
         created_at,
         updated_at
       FROM agent_sessions
       WHERE id = ?`,
    )
    .get(sessionId) as
    | {
        id: string;
        source: string;
        status: string;
        title: string | null;
        discord_guild_id: string | null;
        discord_channel_id: string | null;
        discord_thread_id: string | null;
        linked_change_request_id: string | null;
        linked_target_environment_id: string | null;
        meta_json: string;
        created_by_user_id: string | null;
        last_message_at: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  return row ? parseAgentSessionRow(row) : null;
}

export function findLatestAgentSessionByChangeRequest(changeRequestId: string) {
  const row = getDb()
    .prepare(
      `SELECT
         id,
         source,
         status,
         title,
         discord_guild_id,
         discord_channel_id,
         discord_thread_id,
         linked_change_request_id,
         linked_target_environment_id,
         meta_json,
         created_by_user_id,
         last_message_at,
         created_at,
         updated_at
       FROM agent_sessions
       WHERE linked_change_request_id = ?
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
    )
    .get(changeRequestId) as Parameters<typeof parseAgentSessionRow>[0] | undefined;

  return row ? parseAgentSessionRow(row) : null;
}

export function findAgentSessionByDiscordContext(input: {
  discordThreadId?: string | null;
  discordChannelId?: string | null;
}) {
  if (input.discordThreadId) {
    const threadRow = getDb()
      .prepare(
        `SELECT
           id,
           source,
           status,
           title,
           discord_guild_id,
           discord_channel_id,
           discord_thread_id,
           linked_change_request_id,
           linked_target_environment_id,
           meta_json,
           created_by_user_id,
           last_message_at,
           created_at,
           updated_at
         FROM agent_sessions
         WHERE discord_thread_id = ?
         LIMIT 1`,
      )
      .get(input.discordThreadId) as Parameters<typeof parseAgentSessionRow>[0] | undefined;

    if (threadRow) {
      return parseAgentSessionRow(threadRow);
    }
  }

  if (!input.discordChannelId) {
    return null;
  }

  const row = getDb()
    .prepare(
      `SELECT
         id,
         source,
         status,
         title,
         discord_guild_id,
         discord_channel_id,
         discord_thread_id,
         linked_change_request_id,
         linked_target_environment_id,
         meta_json,
         created_by_user_id,
         last_message_at,
         created_at,
         updated_at
       FROM agent_sessions
       WHERE discord_channel_id = ?
         AND (discord_thread_id IS NULL OR discord_thread_id = '')
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(input.discordChannelId) as Parameters<typeof parseAgentSessionRow>[0] | undefined;

  return row ? parseAgentSessionRow(row) : null;
}

export function findAgentSessionBySourceContext(input: {
  source: string;
  contextKey: string;
}) {
  const source = normalizeText(input.source);
  const contextKey = normalizeText(input.contextKey);
  if (!source || !contextKey) {
    return null;
  }
  const rows = getDb()
    .prepare(
      `SELECT
         id,
         source,
         status,
         title,
         discord_guild_id,
         discord_channel_id,
         discord_thread_id,
         linked_change_request_id,
         linked_target_environment_id,
         meta_json,
         created_by_user_id,
         last_message_at,
         created_at,
         updated_at
       FROM agent_sessions
       WHERE source = ?
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .all(source) as Parameters<typeof parseAgentSessionRow>[0][];

  for (const row of rows) {
    const session = parseAgentSessionRow(row);
    if (session.meta.contextKey === contextKey) {
      return session;
    }
  }

  return null;
}

export function upsertAgentSessionFromSource(input: UpsertAgentSessionInput & { contextKey: string }) {
  const existing = findAgentSessionBySourceContext({
    source: input.source,
    contextKey: input.contextKey,
  });
  if (existing) {
    return updateAgentSession(existing.id, {
      status: input.status,
      title: input.title,
      linkedChangeRequestId: input.linkedChangeRequestId,
      linkedTargetEnvironmentId: input.linkedTargetEnvironmentId,
      meta: {
        ...existing.meta,
        ...(input.meta ?? {}),
        contextKey: input.contextKey,
      },
      createdByUserId: input.createdByUserId,
      lastMessageAt: input.lastMessageAt,
    });
  }

  return createAgentSession({
    source: input.source,
    status: input.status,
    title: input.title,
    linkedChangeRequestId: input.linkedChangeRequestId,
    linkedTargetEnvironmentId: input.linkedTargetEnvironmentId,
    meta: {
      ...(input.meta ?? {}),
      contextKey: input.contextKey,
    },
    createdByUserId: input.createdByUserId,
    lastMessageAt: input.lastMessageAt,
  });
}

export function upsertAgentSessionFromDiscord(input: UpsertAgentSessionInput) {
  const existing = findAgentSessionByDiscordContext({
    discordThreadId: input.discordThreadId,
    discordChannelId: input.discordThreadId ? undefined : input.discordChannelId,
  });
  const now = new Date().toISOString();

  if (existing) {
    getDb()
      .prepare(
        `UPDATE agent_sessions
         SET status = ?,
             title = ?,
             discord_guild_id = ?,
             discord_channel_id = ?,
             discord_thread_id = ?,
             linked_change_request_id = ?,
             linked_target_environment_id = ?,
             meta_json = ?,
             created_by_user_id = ?,
             last_message_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.status ?? existing.status,
        input.title !== undefined ? input.title : existing.title,
        input.discordGuildId !== undefined ? input.discordGuildId : existing.discordGuildId,
        input.discordChannelId !== undefined ? input.discordChannelId : existing.discordChannelId,
        input.discordThreadId !== undefined ? input.discordThreadId : existing.discordThreadId,
        input.linkedChangeRequestId !== undefined ? input.linkedChangeRequestId : existing.linkedChangeRequestId,
        input.linkedTargetEnvironmentId !== undefined
          ? input.linkedTargetEnvironmentId
          : existing.linkedTargetEnvironmentId,
        JSON.stringify(input.meta ?? existing.meta),
        input.createdByUserId !== undefined ? input.createdByUserId : existing.createdByUserId,
        input.lastMessageAt !== undefined ? input.lastMessageAt : existing.lastMessageAt,
        now,
        existing.id,
      );

    return getAgentSession(existing.id);
  }

  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO agent_sessions (
         id, source, status, title, discord_guild_id, discord_channel_id, discord_thread_id,
         linked_change_request_id, linked_target_environment_id, meta_json, created_by_user_id,
         last_message_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.source,
      input.status ?? 'active',
      input.title ?? null,
      input.discordGuildId ?? null,
      input.discordChannelId ?? null,
      input.discordThreadId ?? null,
      input.linkedChangeRequestId ?? null,
      input.linkedTargetEnvironmentId ?? null,
      JSON.stringify(input.meta ?? {}),
      input.createdByUserId ?? null,
      input.lastMessageAt ?? now,
      now,
      now,
    );

  return getAgentSession(id);
}

export function createAgentSession(input: CreateAgentSessionInput) {
  const id = randomUUID();
  const now = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO agent_sessions (
         id, source, status, title, discord_guild_id, discord_channel_id, discord_thread_id,
         linked_change_request_id, linked_target_environment_id, meta_json, created_by_user_id,
         last_message_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.source,
      input.status ?? 'active',
      input.title ?? null,
      null,
      null,
      null,
      input.linkedChangeRequestId ?? null,
      input.linkedTargetEnvironmentId ?? null,
      JSON.stringify(input.meta ?? {}),
      input.createdByUserId ?? null,
      input.lastMessageAt ?? now,
      now,
      now,
    );

  return getAgentSession(id);
}

export function updateAgentSession(sessionId: string, input: UpdateAgentSessionInput) {
  const existing = getAgentSession(sessionId);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();

  getDb()
    .prepare(
      `UPDATE agent_sessions
       SET status = ?,
           title = ?,
           linked_change_request_id = ?,
           linked_target_environment_id = ?,
           meta_json = ?,
           created_by_user_id = ?,
           last_message_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.status ?? existing.status,
      input.title !== undefined ? input.title : existing.title,
      input.linkedChangeRequestId !== undefined ? input.linkedChangeRequestId : existing.linkedChangeRequestId,
      input.linkedTargetEnvironmentId !== undefined
        ? input.linkedTargetEnvironmentId
        : existing.linkedTargetEnvironmentId,
      JSON.stringify(input.meta ?? existing.meta),
      input.createdByUserId !== undefined ? input.createdByUserId : existing.createdByUserId,
      input.lastMessageAt !== undefined ? input.lastMessageAt : existing.lastMessageAt,
      now,
      sessionId,
    );

  return getAgentSession(sessionId);
}

export function listAgentMessages(sessionId: string, limit = 100) {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const rows = getDb()
    .prepare(
      `SELECT *
       FROM (
         SELECT
           id,
           session_id,
           role,
           source,
           source_message_id,
           content,
           meta_json,
           created_at,
           updated_at
         FROM agent_messages
         WHERE session_id = ?
         ORDER BY created_at DESC
         LIMIT ?
       )
       ORDER BY created_at ASC`,
    )
    .all(sessionId, safeLimit) as Array<Parameters<typeof parseAgentMessageRow>[0]>;

  return rows.map(parseAgentMessageRow);
}

export function createAgentMessage(input: CreateAgentMessageInput) {
  const session = getAgentSession(input.sessionId);
  if (!session) {
    return null;
  }

  const id = randomUUID();
  const now = input.createdAt ?? new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO agent_messages (
         id, session_id, role, source, source_message_id, content, meta_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.sessionId,
      input.role,
      input.source,
      input.sourceMessageId ?? null,
      input.content,
      JSON.stringify(input.meta ?? {}),
      now,
      now,
    );

  getDb()
    .prepare(
      `UPDATE agent_sessions
       SET last_message_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(now, now, input.sessionId);

  const row = getDb()
    .prepare(
      `SELECT
         id,
         session_id,
         role,
         source,
         source_message_id,
         content,
         meta_json,
         created_at,
         updated_at
       FROM agent_messages
       WHERE id = ?`,
    )
    .get(id) as Parameters<typeof parseAgentMessageRow>[0] | undefined;

  return row ? parseAgentMessageRow(row) : null;
}

export function createAgentResponseJob(input: CreateAgentResponseJobInput) {
  const id = randomUUID();
  const now = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO agent_response_jobs (
         id, session_id, status, input_json, response_json, output_text, error_message,
         trace_json, started_at, finished_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.sessionId ?? null,
      'queued',
      JSON.stringify(input.input),
      '{}',
      null,
      null,
      '[]',
      null,
      null,
      now,
      now,
    );

  return getAgentResponseJob(id);
}

export function getAgentResponseJob(id: string) {
  const row = getDb()
    .prepare(
      `SELECT
         id,
         session_id,
         status,
         input_json,
         response_json,
         output_text,
         error_message,
         trace_json,
         started_at,
         finished_at,
         created_at,
         updated_at
       FROM agent_response_jobs
       WHERE id = ?`,
    )
    .get(id) as Parameters<typeof parseAgentResponseJobRow>[0] | undefined;

  return row ? parseAgentResponseJobRow(row) : null;
}

export function updateAgentResponseJob(id: string, input: UpdateAgentResponseJobInput) {
  const existing = getAgentResponseJob(id);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE agent_response_jobs
       SET session_id = ?,
           status = ?,
           input_json = ?,
           response_json = ?,
           output_text = ?,
           error_message = ?,
           trace_json = ?,
           started_at = ?,
           finished_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.sessionId !== undefined ? input.sessionId : existing.sessionId,
      input.status ?? existing.status,
      JSON.stringify(existing.input),
      JSON.stringify(input.response ?? existing.response),
      input.outputText !== undefined ? input.outputText : existing.outputText,
      input.errorMessage !== undefined ? input.errorMessage : existing.errorMessage,
      JSON.stringify(input.trace ?? existing.trace),
      input.startedAt !== undefined ? input.startedAt : existing.startedAt,
      input.finishedAt !== undefined ? input.finishedAt : existing.finishedAt,
      now,
      id,
    );

  return getAgentResponseJob(id);
}

export function createAgentRun(input: CreateAgentRunInput) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const kind = normalizeText(input.kind) || 'console';
  const source = normalizeText(input.source) || 'site';
  const lane = inferAgentRunLane({ lane: input.lane, kind, source });
  const priority = normalizeAgentRunPriority(input.priority, defaultAgentRunPriority(lane));
  const queuedAt = normalizeText(input.queuedAt) || now;
  getDb()
    .prepare(
      `INSERT INTO agent_runs (
         id, kind, status, lane, priority, idempotency_key, request_id, workflow_run_id, workflow_step_key,
         task_key, hook_key, session_id, agent_profile_id, agent_profile_version, execution_mode,
         executor_resolution, accountability_snapshot_json,
         source, input_json, result_json, trace_json,
         error_message, queued_at, claimed_at, lease_expires_at, queue_reason,
         started_at, finished_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      kind,
      normalizeText(input.status) || 'queued',
      lane,
      priority,
      normalizeText(input.idempotencyKey) || null,
      normalizeText(input.requestId) || null,
      normalizeText(input.workflowRunId) || null,
      normalizeText(input.workflowStepKey) || null,
      normalizeText(input.taskKey) || null,
      normalizeText(input.hookKey) || null,
      normalizeText(input.sessionId) || null,
      normalizeText(input.agentProfileId) || null,
      input.agentProfileVersion == null ? null : Math.max(1, Math.trunc(input.agentProfileVersion)),
      normalizeText(input.executionMode) || null,
      normalizeText(input.executorResolution) || (input.agentProfileId ? 'not-applicable' : null),
      JSON.stringify(input.accountabilitySnapshot ?? {}),
      source,
      JSON.stringify(input.input ?? {}),
      JSON.stringify(input.result ?? {}),
      JSON.stringify(input.trace ?? []),
      normalizeText(input.errorMessage) || null,
      queuedAt,
      normalizeText(input.claimedAt) || null,
      normalizeText(input.leaseExpiresAt) || null,
      normalizeText(input.queueReason) || null,
      normalizeText(input.startedAt) || null,
      normalizeText(input.finishedAt) || null,
      now,
      now,
    );
  return getAgentRun(id);
}

export function getAgentRun(id: string) {
  const row = getDb().prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as AgentRunRow | undefined;
  return row ? mapAgentRunRow(row) : null;
}

export function updateAgentRun(id: string, input: UpdateAgentRunInput) {
  const current = getAgentRun(id);
  if (!current) {
    return null;
  }
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE agent_runs
       SET kind = @kind,
           status = @status,
           lane = @lane,
           priority = @priority,
           idempotency_key = @idempotencyKey,
           request_id = @requestId,
           workflow_run_id = @workflowRunId,
           workflow_step_key = @workflowStepKey,
           task_key = @taskKey,
           hook_key = @hookKey,
           session_id = @sessionId,
           source = @source,
           input_json = @inputJson,
           result_json = @resultJson,
           trace_json = @traceJson,
           error_message = @errorMessage,
           queued_at = @queuedAt,
           claimed_at = @claimedAt,
           lease_expires_at = @leaseExpiresAt,
           queue_reason = @queueReason,
           started_at = @startedAt,
           finished_at = @finishedAt,
           updated_at = @updatedAt
       WHERE id = @id`,
    )
    .run({
      id,
      kind: input.kind === undefined ? current.kind : normalizeText(input.kind) || current.kind,
      status: input.status === undefined ? current.status : normalizeText(input.status) || current.status,
      lane: input.lane === undefined ? current.lane : normalizeAgentRunLane(input.lane, current.lane),
      priority: input.priority === undefined
        ? current.priority
        : normalizeAgentRunPriority(input.priority, current.priority),
      idempotencyKey:
        input.idempotencyKey === undefined ? current.idempotencyKey : normalizeText(input.idempotencyKey) || null,
      requestId: input.requestId === undefined ? current.requestId : normalizeText(input.requestId) || null,
      workflowRunId:
        input.workflowRunId === undefined ? current.workflowRunId : normalizeText(input.workflowRunId) || null,
      workflowStepKey:
        input.workflowStepKey === undefined ? current.workflowStepKey : normalizeText(input.workflowStepKey) || null,
      taskKey: input.taskKey === undefined ? current.taskKey : normalizeText(input.taskKey) || null,
      hookKey: input.hookKey === undefined ? current.hookKey : normalizeText(input.hookKey) || null,
      sessionId: input.sessionId === undefined ? current.sessionId : normalizeText(input.sessionId) || null,
      source: input.source === undefined ? current.source : normalizeText(input.source) || current.source,
      inputJson: input.input === undefined ? JSON.stringify(current.input) : JSON.stringify(input.input),
      resultJson: input.result === undefined ? JSON.stringify(current.result) : JSON.stringify(input.result),
      traceJson: input.trace === undefined ? JSON.stringify(current.trace) : JSON.stringify(input.trace),
      errorMessage: input.errorMessage === undefined ? current.errorMessage : normalizeText(input.errorMessage) || null,
      queuedAt: input.queuedAt === undefined ? current.queuedAt : normalizeText(input.queuedAt) || current.queuedAt,
      claimedAt: input.claimedAt === undefined ? current.claimedAt : normalizeText(input.claimedAt) || null,
      leaseExpiresAt:
        input.leaseExpiresAt === undefined ? current.leaseExpiresAt : normalizeText(input.leaseExpiresAt) || null,
      queueReason:
        input.queueReason === undefined ? current.queueReason : normalizeText(input.queueReason) || null,
      startedAt: input.startedAt === undefined ? current.startedAt : normalizeText(input.startedAt) || null,
      finishedAt: input.finishedAt === undefined ? current.finishedAt : normalizeText(input.finishedAt) || null,
      updatedAt: now,
    });
  return getAgentRun(id);
}

export function listAgentRuns(input: {
  kind?: string | null;
  status?: string | null;
  requestId?: string | null;
  taskKey?: string | null;
  hookKey?: string | null;
  lane?: string | null;
  limit?: number;
} = {}) {
  const limit = Math.max(1, Math.min(Number(input.limit ?? 50), 200));
  const filters: string[] = [];
  const params: unknown[] = [];
  const kind = normalizeText(input.kind);
  const status = normalizeText(input.status);
  const requestId = normalizeText(input.requestId);
  const taskKey = normalizeText(input.taskKey);
  const hookKey = normalizeText(input.hookKey);
  const lane = normalizeAgentRunLane(input.lane, '');
  if (kind) {
    filters.push('kind = ?');
    params.push(kind);
  }
  if (status) {
    filters.push('status = ?');
    params.push(status);
  }
  if (requestId) {
    filters.push('request_id = ?');
    params.push(requestId);
  }
  if (taskKey) {
    filters.push('task_key = ?');
    params.push(taskKey);
  }
  if (hookKey) {
    filters.push('hook_key = ?');
    params.push(hookKey);
  }
  if (lane) {
    filters.push('lane = ?');
    params.push(lane);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM agent_runs ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as AgentRunRow[];
  return mapAgentRunRowsWithQueuePositions(rows);
}

export function computeAgentRunQueuePosition(input: {
  id: string;
  lane: string;
  priority: number;
  queuedAt: string;
  createdAt: string;
}) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM agent_runs
       WHERE status = 'queued'
         AND lane = @lane
         AND id != @id
         AND (
           priority > @priority
           OR (priority = @priority AND COALESCE(queued_at, created_at) < @queuedAt)
           OR (
             priority = @priority
             AND COALESCE(queued_at, created_at) = @queuedAt
             AND created_at < @createdAt
           )
           OR (
             priority = @priority
             AND COALESCE(queued_at, created_at) = @queuedAt
             AND created_at = @createdAt
             AND id < @id
           )
         )`,
    )
    .get({
      id: input.id,
      lane: normalizeAgentRunLane(input.lane),
      priority: input.priority,
      queuedAt: input.queuedAt,
      createdAt: input.createdAt,
    }) as { count: number } | undefined;
  return Number(row?.count ?? 0) + 1;
}

export function countRunningAgentRuns(input: { lane?: string | null } = {}) {
  const lane = normalizeAgentRunLane(input.lane, '');
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM agent_runs WHERE status = 'running'${lane ? ' AND lane = ?' : ''}`)
    .get(...(lane ? [lane] : [])) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

export function expireStaleRunningAgentRuns(input: {
  now?: string;
  reason?: string;
  staleUnleasedSeconds?: number;
} = {}) {
  const now = input.now ?? new Date().toISOString();
  const reason = input.reason ?? 'Agent run lease expired before completion.';
  const staleUnleasedSeconds = Number(input.staleUnleasedSeconds);
  const staleUnleasedCutoff =
    Number.isFinite(staleUnleasedSeconds) && staleUnleasedSeconds > 0
      ? addSecondsIso(new Date(now), -Math.trunc(staleUnleasedSeconds))
      : null;
  const rows = getDb()
    .prepare(
      `SELECT *
       FROM agent_runs
       WHERE status = 'running'
         AND (
           (lease_expires_at IS NOT NULL AND lease_expires_at <= @now)
           OR (
             @staleUnleasedCutoff IS NOT NULL
             AND lease_expires_at IS NULL
             AND COALESCE(claimed_at, started_at) IS NOT NULL
             AND COALESCE(claimed_at, started_at) <= @staleUnleasedCutoff
           )
         )`,
    )
    .all({ now, staleUnleasedCutoff }) as AgentRunRow[];

  return rows.map((row) => updateAgentRun(row.id, {
    status: 'failed',
    errorMessage: reason,
    leaseExpiresAt: null,
    queueReason: null,
    finishedAt: now,
  })).filter((run): run is AgentRunRecord => Boolean(run));
}

export function claimNextQueuedAgentRun(input: {
  lane: 'interactive' | 'workflow' | 'background';
  leaseSeconds: number;
  now?: Date;
}) {
  const lane = normalizeAgentRunLane(input.lane);
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const leaseExpiresAt = addSecondsIso(now, input.leaseSeconds);

  const claimTransaction = getDb().transaction(() => {
    const candidate = getDb()
      .prepare(
        `SELECT *
         FROM agent_runs
         WHERE status = 'queued'
           AND lane = ?
         ORDER BY priority DESC, COALESCE(queued_at, created_at) ASC, created_at ASC, id ASC
         LIMIT 1`,
      )
      .get(lane) as AgentRunRow | undefined;
    if (!candidate) {
      return null;
    }

    const result = getDb()
      .prepare(
        `UPDATE agent_runs
         SET status = 'running',
             claimed_at = @claimedAt,
             lease_expires_at = @leaseExpiresAt,
             queue_reason = NULL,
             started_at = COALESCE(started_at, @claimedAt),
             updated_at = @claimedAt
         WHERE id = @id
           AND status = 'queued'`,
      )
      .run({
        id: candidate.id,
        claimedAt: nowIso,
        leaseExpiresAt,
      });
    return result.changes === 1 ? getAgentRun(candidate.id) : null;
  });

  return claimTransaction();
}

export function findActiveAgentRunByIdempotencyKey(idempotencyKey: string) {
  const key = normalizeText(idempotencyKey);
  if (!key) {
    return null;
  }
  const row = getDb()
    .prepare(
      `SELECT *
       FROM agent_runs
       WHERE idempotency_key = ?
         AND status IN ('queued', 'running')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(key) as AgentRunRow | undefined;
  return row ? mapAgentRunRow(row) : null;
}

export function listActiveAgentRunsForRequest(requestId: string) {
  const id = normalizeText(requestId);
  if (!id) {
    return [];
  }
  const rows = getDb()
    .prepare(
      `SELECT *
       FROM agent_runs
       WHERE request_id = ?
         AND status IN ('queued', 'running')
       ORDER BY created_at DESC`,
    )
    .all(id) as AgentRunRow[];
  return mapAgentRunRowsWithQueuePositions(rows);
}

export function cancelActiveAgentRunsForRequest(input: {
  requestId: string;
  reason: string;
  status?: 'canceled' | 'superseded';
}) {
  const runs = listActiveAgentRunsForRequest(input.requestId);
  const now = new Date().toISOString();
  return runs.map((run) => updateAgentRun(run.id, {
    status: input.status ?? 'canceled',
    result: {
      ...run.result,
      canceledReason: input.reason,
    },
    errorMessage: input.reason,
    finishedAt: now,
  })).filter((run): run is AgentRunRecord => Boolean(run));
}

export function getAdminChangeRequest(changeRequestId: string) {
  const row = getDb()
    .prepare(
      `SELECT
         acr.id,
         acr.request_type,
         acr.title,
         acr.state,
         acr.priority,
         acr.payload_json,
         acr.requested_by_user_id,
         requester.display_name AS requested_by_display_name,
         acr.assigned_to_user_id,
         assignee.display_name AS assigned_to_display_name,
         acr.resolution_note,
         acr.created_at,
         acr.updated_at,
         acr.resolved_at
       FROM admin_change_requests acr
       LEFT JOIN profiles requester ON requester.user_id = acr.requested_by_user_id
       LEFT JOIN profiles assignee ON assignee.user_id = acr.assigned_to_user_id
       WHERE acr.id = ?`,
    )
    .get(changeRequestId) as
    | {
        id: string;
        request_type: string;
        title: string;
        state: string;
        priority: string;
        payload_json: string;
        requested_by_user_id: string | null;
        requested_by_display_name: string | null;
        assigned_to_user_id: string | null;
        assigned_to_display_name: string | null;
        resolution_note: string | null;
        created_at: string;
        updated_at: string;
        resolved_at: string | null;
      }
    | undefined;

  return row ? parseChangeRequestRow(row) : null;
}

export function createAdminChangeRequest(input: CreateAdminChangeRequestInput) {
  const now = new Date().toISOString();
  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO admin_change_requests (
         id, request_type, title, state, priority, payload_json,
         requested_by_user_id, assigned_to_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.requestType,
      input.title,
      input.priority || 'normal',
      JSON.stringify(input.payload ?? {}),
      input.requestedByUserId ?? null,
      input.assignedToUserId ?? null,
      now,
      now,
    );

  return getAdminChangeRequest(id);
}

export function updateAdminChangeRequest(changeRequestId: string, input: UpdateAdminChangeRequestInput) {
  const current = getAdminChangeRequest(changeRequestId);
  if (!current) {
    return null;
  }

  const nextState = input.state ?? current.state;
  const nextPriority = input.priority ?? current.priority;
  const nextResolutionNote = input.resolutionNote ?? current.resolutionNote;
  const nextAssignedToUserId = input.assignedToUserId ?? current.assignedToUserId;
  const updatedAt = new Date().toISOString();
  const resolvedAt = nextState === 'closed' ? current.resolvedAt ?? updatedAt : null;

  getDb()
    .prepare(
      `UPDATE admin_change_requests
       SET state = ?,
           priority = ?,
           assigned_to_user_id = ?,
           resolution_note = ?,
           updated_at = ?,
           resolved_at = ?
       WHERE id = ?`,
    )
    .run(nextState, nextPriority, nextAssignedToUserId, nextResolutionNote, updatedAt, resolvedAt, changeRequestId);

  return getAdminChangeRequest(changeRequestId);
}

export function applyAdminChangeRequest(changeRequestId: string, actorUserId: string, resolutionNote?: string) {
  const current = getAdminChangeRequest(changeRequestId);
  if (!current) {
    return null;
  }

  if (current.state === 'closed') {
    throw new Error('ALREADY_APPLIED');
  }

  const transaction = getDb().transaction(() => {
    const now = new Date().toISOString();
    let applyResult: AdminChangeRequestApplyResult;

    if (current.requestType === 'points_adjustment') {
      const requestedUserIds = uniqueStrings(current.payload.userIds);
      const validUserIds = listExistingUserIds(requestedUserIds);
      const skippedUserIds = requestedUserIds.filter((userId) => !validUserIds.includes(userId));
      const delta = Number(current.payload.delta);
      const reason = normalizeText(current.payload.reason);

      if (!requestedUserIds.length) {
        throw new Error('NO_TARGET_USERS');
      }

      if (!validUserIds.length) {
        throw new Error('NO_VALID_TARGET_USERS');
      }

      if (!Number.isInteger(delta) || delta === 0) {
        throw new Error('INVALID_POINTS_DELTA');
      }

      if (!reason) {
        throw new Error('CHANGE_REQUEST_REASON_REQUIRED');
      }

      const insertLedger = getDb().prepare(
        `INSERT INTO points_ledger (id, user_id, delta, source_type, source_id, reason, meta_json, created_at)
         VALUES (?, ?, ?, 'admin_change_request', ?, ?, ?, ?)`,
      );

      for (const userId of validUserIds) {
        insertLedger.run(
          randomUUID(),
          userId,
          delta,
          changeRequestId,
          reason,
          JSON.stringify({ requestType: current.requestType, actorUserId }),
          now,
        );
      }

      applyResult = {
        kind: 'points_adjustment',
        affectedUserIds: validUserIds,
        skippedUserIds,
        pointsEntriesCreated: validUserIds.length,
      };
    } else if (current.requestType === 'badge_create') {
      const payloadBadge = current.payload.badge && typeof current.payload.badge === 'object' && !Array.isArray(current.payload.badge)
        ? current.payload.badge as Record<string, unknown>
        : null;
      const badgeSlugInput = normalizeText(current.payload.badgeSlug) || normalizeText(payloadBadge?.slug);
      const badgeLabelInput = normalizeText(current.payload.badgeLabel) || normalizeText(payloadBadge?.label);
      const badgeDescription = normalizeText(current.payload.badgeDescription) || normalizeText(payloadBadge?.description) || null;
      const badgeImageUrl = normalizeText(current.payload.badgeImageUrl) || normalizeText(payloadBadge?.imageUrl) || normalizeText(payloadBadge?.image_url) || null;
      const badgeSlug = slugifyValue(badgeSlugInput || badgeLabelInput);
      const badgeLabel = badgeLabelInput || titleizeSlug(badgeSlug);

      if (!badgeSlug || !badgeLabel) {
        throw new Error('BADGE_DETAILS_REQUIRED');
      }

      const badge = ensureBadgeRecord({
        slug: badgeSlug,
        label: badgeLabel,
        description: badgeDescription,
        imageUrl: badgeImageUrl,
      });

      applyResult = {
        kind: 'badge_create',
        affectedUserIds: [],
        skippedUserIds: [],
        badgeSlug: badge.slug,
        badgeLabel: badge.label,
        badgeCreated: badge.created,
      };
    } else if (current.requestType === 'badge_award') {
      const badgeSlug = normalizeText(current.payload.badgeSlug);
      const badgeLabel = normalizeText(current.payload.badgeLabel) || titleizeSlug(badgeSlug);
      const reason = normalizeText(current.payload.reason);
      const requestedUserIds = uniqueStrings(current.payload.userIds);
      const validUserIds = listExistingUserIds(requestedUserIds);
      const invalidUserIds = requestedUserIds.filter((userId) => !validUserIds.includes(userId));

      if (!badgeSlug) {
        throw new Error('BADGE_SELECTION_REQUIRED');
      }

      if (!requestedUserIds.length) {
        throw new Error('NO_TARGET_USERS');
      }

      if (!validUserIds.length) {
        throw new Error('NO_VALID_TARGET_USERS');
      }

      if (!reason) {
        throw new Error('CHANGE_REQUEST_REASON_REQUIRED');
      }

      const badge = getBadgeBySlug(badgeSlug);
      if (!badge) {
        throw new Error('BADGE_NOT_FOUND');
      }

      const existingAwards = listExistingBadgeAwards(badge.id, validUserIds);
      const awardableUserIds = validUserIds.filter((userId) => !existingAwards.includes(userId));
      const insertAward = getDb().prepare(
        `INSERT INTO user_badges (id, user_id, badge_id, awarded_by_user_id, awarded_at, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );

      for (const userId of awardableUserIds) {
        insertAward.run(randomUUID(), userId, badge.id, actorUserId, now, reason);
      }

      applyResult = {
        kind: 'badge_award',
        affectedUserIds: awardableUserIds,
        skippedUserIds: [...invalidUserIds, ...existingAwards],
        badgeSlug: badge.slug,
        badgeLabel: badge.label || badgeLabel,
        badgeCreated: false,
        badgeAwardsCreated: awardableUserIds.length,
      };
    } else if (current.requestType === 'badge_request') {
      const payloadBadge = current.payload.badge && typeof current.payload.badge === 'object' && !Array.isArray(current.payload.badge)
        ? current.payload.badge as Record<string, unknown>
        : null;
      const badgeSlugInput = normalizeText(payloadBadge?.slug);
      const badgeLabelInput = normalizeText(payloadBadge?.label);
      const badgeDescription = normalizeText(payloadBadge?.description) || null;
      const badgeImageUrl = normalizeText(payloadBadge?.imageUrl) || normalizeText(payloadBadge?.image_url) || null;
      const badgeSlug = slugifyValue(badgeSlugInput || badgeLabelInput);
      const badgeLabel = badgeLabelInput || titleizeSlug(badgeSlug);
      const reason = normalizeText(current.payload.reason);
      const requestedUserIds = uniqueStrings(current.payload.userIds);
      const validUserIds = listExistingUserIds(requestedUserIds);
      const invalidUserIds = requestedUserIds.filter((userId) => !validUserIds.includes(userId));

      if (!badgeSlug || !badgeLabel) {
        throw new Error('BADGE_DETAILS_REQUIRED');
      }

      if (requestedUserIds.length && !validUserIds.length) {
        throw new Error('NO_VALID_TARGET_USERS');
      }

      if (requestedUserIds.length && !reason) {
        throw new Error('CHANGE_REQUEST_REASON_REQUIRED');
      }

      const badge = ensureBadgeRecord({
        slug: badgeSlug,
        label: badgeLabel,
        description: badgeDescription,
        imageUrl: badgeImageUrl,
      });

      const existingAwards = listExistingBadgeAwards(badge.id, validUserIds);
      const awardableUserIds = validUserIds.filter((userId) => !existingAwards.includes(userId));
      const insertAward = getDb().prepare(
        `INSERT INTO user_badges (id, user_id, badge_id, awarded_by_user_id, awarded_at, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );

      for (const userId of awardableUserIds) {
        insertAward.run(randomUUID(), userId, badge.id, actorUserId, now, reason || `Awarded via ${current.title}`);
      }

      applyResult = {
        kind: 'badge_request',
        affectedUserIds: awardableUserIds,
        skippedUserIds: [...invalidUserIds, ...existingAwards],
        badgeSlug: badge.slug,
        badgeLabel: badge.label,
        badgeCreated: badge.created,
        badgeAwardsCreated: awardableUserIds.length,
      };
    } else if (current.requestType === 'site_content_update') {
      const siteContentValue = current.payload.siteContent;

      if (!siteContentValue || typeof siteContentValue !== 'object' || Array.isArray(siteContentValue)) {
        throw new Error('SITE_CONTENT_REQUIRED');
      }

      writeSiteContent(loadConfig(), normalizeSiteContent(siteContentValue));

      applyResult = {
        kind: 'site_content_update',
        affectedUserIds: [],
        skippedUserIds: [],
        siteContentUpdated: true,
      };
    } else {
      throw new Error('UNSUPPORTED_REQUEST_TYPE');
    }

    getDb()
      .prepare(
        `UPDATE admin_change_requests
         SET state = 'closed',
             assigned_to_user_id = ?,
             resolution_note = ?,
             updated_at = ?,
             resolved_at = ?
         WHERE id = ?`,
      )
      .run(actorUserId, resolutionNote ?? current.resolutionNote ?? 'Applied through admin board', now, now, changeRequestId);

    return applyResult;
  });

  const applyResult = transaction();
  const changeRequest = getAdminChangeRequest(changeRequestId);

  if (!changeRequest) {
    throw new Error('APPLY_RESULT_MISSING');
  }

  return {
    changeRequest,
    applyResult,
  };
}

export function createAuditLog(entry: {
  actorUserId: string | null;
  actionType: string;
  targetType: string;
  targetId: string | null;
  meta?: Record<string, unknown>;
}) {
  getDb()
    .prepare(
      `INSERT INTO audit_log (id, actor_user_id, action_type, target_type, target_id, meta_json, created_at)
       VALUES (@id, @actorUserId, @actionType, @targetType, @targetId, @metaJson, @createdAt)`,
    )
    .run({
      id: randomUUID(),
      actorUserId: entry.actorUserId,
      actionType: entry.actionType,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metaJson: JSON.stringify(entry.meta ?? {}),
      createdAt: new Date().toISOString(),
    });
}

export function registerOrClaimUser(input: RegisterInput) {
  const db = getDb();
  const now = new Date().toISOString();
  const email = normalizeEmail(input.email);
  const handle = normalizeHandle(input.handle);

  const userByEmail = getUserByEmail(email);
  const profileByHandle = getProfileRowByHandle(handle);

  if (userByEmail?.password_hash) {
    throw new Error('EMAIL_IN_USE');
  }

  if (profileByHandle && profileByHandle.claimed_at && profileByHandle.user_id !== userByEmail?.id) {
    throw new Error('HANDLE_TAKEN');
  }

  const transaction = db.transaction(() => {
    if (userByEmail) {
      db.prepare(
        `UPDATE users
         SET password_hash = ?, updated_at = ?, last_seen_at = ?
         WHERE id = ?`,
      ).run(input.passwordHash, now, now, userByEmail.id);

      const existingProfile = getProfileRowByUserId(userByEmail.id);

      if (existingProfile) {
        const conflictingHandle = getProfileRowByHandle(handle);
        if (!conflictingHandle || conflictingHandle.user_id === userByEmail.id) {
          db.prepare(
            `UPDATE profiles
             SET handle = ?, display_name = ?, email = ?, claimed_at = COALESCE(claimed_at, ?), updated_at = ?
             WHERE user_id = ?`,
          ).run(handle, input.displayName.trim(), email, now, now, userByEmail.id);
        } else {
          db.prepare(
            `UPDATE profiles
             SET display_name = ?, email = ?, claimed_at = COALESCE(claimed_at, ?), updated_at = ?
             WHERE user_id = ?`,
          ).run(input.displayName.trim(), email, now, now, userByEmail.id);
        }
      } else {
        db.prepare(
          `INSERT INTO profiles (
             id, user_id, handle, display_name, email, seed_source, claimed_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(randomUUID(), userByEmail.id, handle, input.displayName.trim(), email, null, now, now, now);
      }

      return userByEmail.id;
    }

    if (profileByHandle && !profileByHandle.claimed_at && profileByHandle.user_id) {
      const seededUser = getUserById(profileByHandle.user_id);

      if (seededUser?.password_hash) {
        throw new Error('HANDLE_TAKEN');
      }

      if (seededUser?.email && seededUser.email !== email) {
        throw new Error('SEED_EMAIL_MISMATCH');
      }

      db.prepare(
        `UPDATE users
         SET email = ?, password_hash = ?, updated_at = ?, last_seen_at = ?
         WHERE id = ?`,
      ).run(email, input.passwordHash, now, now, profileByHandle.user_id);

      db.prepare(
        `UPDATE profiles
         SET display_name = ?, email = ?, claimed_at = COALESCE(claimed_at, ?), updated_at = ?
         WHERE id = ?`,
      ).run(input.displayName.trim(), email, now, now, profileByHandle.id);

      return profileByHandle.user_id;
    }

    if (profileByHandle) {
      throw new Error('HANDLE_TAKEN');
    }

    const userId = randomUUID();

    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(userId, email, input.passwordHash, now, now, now);

    db.prepare(
      `INSERT INTO profiles (
         id, user_id, handle, display_name, email, claimed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), userId, handle, input.displayName.trim(), email, now, now, now);

    return userId;
  });

  const userId = transaction();
  return getSessionSummary(userId);
}

export function getSessionSummary(userId: string) {
  const user = getUserById(userId);
  if (!user) return null;

  const profile = getProfileRowByUserId(userId);

  return {
    id: user.id,
    email: user.email,
    handle: profile?.handle ?? null,
    displayName: profile?.display_name ?? null,
    roleSlugs: listRoleSlugsForUser(userId),
  } satisfies SessionUser;
}

export function updateUserLastSeen(userId: string) {
  getDb()
    .prepare('UPDATE users SET last_seen_at = ?, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), new Date().toISOString(), userId);
}

export function listWorkflows(): WorkflowRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, key, name, description, version, definition_json, system_default, enabled, created_at, updated_at
       FROM workflows
       ORDER BY system_default DESC, key ASC`,
    )
    .all() as WorkflowRow[];

  return rows.map(mapWorkflowRow);
}

export function getWorkflowByKey(key: string): WorkflowRecord | null {
  const row = getDb()
    .prepare(
      `SELECT id, key, name, description, version, definition_json, system_default, enabled, created_at, updated_at
       FROM workflows
       WHERE key = ?`,
    )
    .get(key) as WorkflowRow | undefined;

  return row ? mapWorkflowRow(row) : null;
}

export function upsertWorkflow(input: {
  key: string;
  name: string;
  description?: string | null;
  version?: number;
  definition: Record<string, unknown>;
  systemDefault?: boolean;
  enabled?: boolean;
}): WorkflowRecord {
  const now = new Date().toISOString();
  const existing = getWorkflowByKey(input.key);
  const id = existing?.id ?? randomUUID();
  const nextSystemDefault = input.systemDefault ?? existing?.systemDefault ?? false;
  const nextEnabled = input.enabled ?? existing?.enabled ?? true;

  getDb()
    .prepare(
      `INSERT INTO workflows (
         id, key, name, description, version, definition_json, system_default, enabled, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         version = excluded.version,
         definition_json = excluded.definition_json,
         system_default = excluded.system_default,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      input.key,
      input.name,
      input.description ?? null,
      input.version ?? 1,
      JSON.stringify(input.definition),
      nextSystemDefault ? 1 : 0,
      nextEnabled ? 1 : 0,
      existing?.createdAt ?? now,
      now,
    );

  const workflow = getWorkflowByKey(input.key);
  if (!workflow) {
    throw new Error('WORKFLOW_UPSERT_FAILED');
  }

  return workflow;
}

function workflowStepsFromDefinition(workflow: WorkflowRecord | null | undefined) {
  const steps = Array.isArray(workflow?.definition?.steps) ? workflow.definition.steps : [];
  return steps.filter((step): step is Record<string, unknown> => {
    return Boolean(step) && typeof step === 'object' && !Array.isArray(step) && typeof step.key === 'string';
  });
}

function workflowEntrypoint(workflow: WorkflowRecord | null | undefined) {
  const entrypoint = workflow?.definition?.entrypoint;
  if (typeof entrypoint === 'string' && entrypoint.trim()) {
    return entrypoint.trim();
  }
  return workflowStepsFromDefinition(workflow)[0]?.key as string | undefined ?? 'triage';
}

function workflowStepForKey(workflow: WorkflowRecord | null | undefined, stepKey: string | null | undefined) {
  if (!stepKey) {
    return null;
  }
  return workflowStepsFromDefinition(workflow).find((step) => step.key === stepKey) ?? null;
}

function workflowStepIsTerminal(workflow: WorkflowRecord | null | undefined, stepKey: string | null | undefined) {
  const step = workflowStepForKey(workflow, stepKey);
  return step?.type === 'terminal';
}

export function getWorkflowRunForRequest(requestId: string): WorkflowRunRecord | null {
  const row = getDb()
    .prepare(
      `SELECT id, request_id, workflow_key, current_step_key, status, meta_json, created_at, updated_at, completed_at
       FROM workflow_runs
       WHERE request_id = ?`,
    )
    .get(requestId) as WorkflowRunRow | undefined;

  return row ? mapWorkflowRunRow(row) : null;
}

export function getWorkflowRun(workflowRunId: string): WorkflowRunRecord | null {
  const row = getDb()
    .prepare(
      `SELECT id, request_id, workflow_key, current_step_key, status, meta_json, created_at, updated_at, completed_at
       FROM workflow_runs
       WHERE id = ?`,
    )
    .get(workflowRunId) as WorkflowRunRow | undefined;

  return row ? mapWorkflowRunRow(row) : null;
}

export function ensureWorkflowRunForRequest(input: {
  requestId: string;
  workflowKey: string;
  currentStepKey?: string | null;
  meta?: Record<string, unknown>;
}): WorkflowRunRecord {
  const existing = getWorkflowRunForRequest(input.requestId);
  if (existing) {
    return existing;
  }

  const workflow = getWorkflowByKey(input.workflowKey);
  const currentStepKey =
    normalizeText(input.currentStepKey) ||
    workflowEntrypoint(workflow);
  const now = new Date().toISOString();
  const id = randomUUID();
  const terminal = workflowStepIsTerminal(workflow, currentStepKey);
  const runStatus = terminal ? 'completed' : 'active';
  const completedAt = terminal ? now : null;

  getDb()
    .prepare(
      `INSERT INTO workflow_runs (
         id, request_id, workflow_key, current_step_key, status, meta_json, created_at, updated_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.requestId, input.workflowKey, currentStepKey, runStatus, JSON.stringify(input.meta ?? {}), now, now, completedAt);

  const run = getWorkflowRunForRequest(input.requestId);
  if (!run) {
    throw new Error('WORKFLOW_RUN_CREATE_FAILED');
  }

  createWorkflowEvent({
    workflowRunId: run.id,
    requestId: input.requestId,
    stepKey: run.currentStepKey,
    eventType: 'workflow.started',
    actorType: 'system',
    payload: {
      workflowKey: run.workflowKey,
    },
  });

  return run;
}

export function updateWorkflowRun(input: {
  requestId: string;
  currentStepKey?: string;
  status?: string;
  meta?: Record<string, unknown>;
  completedAt?: string | null;
}): WorkflowRunRecord | null {
  const existing = getWorkflowRunForRequest(input.requestId);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE workflow_runs
       SET current_step_key = ?,
           status = ?,
           meta_json = ?,
           updated_at = ?,
           completed_at = ?
       WHERE id = ?`,
    )
    .run(
      input.currentStepKey ?? existing.currentStepKey,
      input.status ?? existing.status,
      JSON.stringify(input.meta ?? existing.meta),
      now,
      input.completedAt !== undefined ? input.completedAt : existing.completedAt,
      existing.id,
    );

  return getWorkflowRunForRequest(input.requestId);
}

export function createWorkflowEvent(input: {
  workflowRunId: string;
  requestId: string;
  stepKey?: string | null;
  eventType: string;
  actorType?: string;
  actorId?: string | null;
  note?: string | null;
  payload?: Record<string, unknown>;
}): WorkflowEventRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO workflow_events (
         id, workflow_run_id, request_id, step_key, event_type, actor_type, actor_id, note, payload_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.workflowRunId,
      input.requestId,
      input.stepKey ?? null,
      input.eventType,
      normalizeText(input.actorType) || 'system',
      input.actorId ?? null,
      normalizeText(input.note) || null,
      JSON.stringify(input.payload ?? {}),
      now,
    );

  const row = getDb()
    .prepare(
      `SELECT id, workflow_run_id, request_id, step_key, event_type, actor_type, actor_id, note, payload_json, created_at
       FROM workflow_events
       WHERE id = ?`,
    )
    .get(id) as WorkflowEventRow | undefined;

  if (!row) {
    throw new Error('WORKFLOW_EVENT_CREATE_FAILED');
  }

  return mapWorkflowEventRow(row);
}

export function listWorkflowEventsForRequest(requestId: string, limit = 100): WorkflowEventRecord[] {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const rows = getDb()
    .prepare(
      `SELECT id, workflow_run_id, request_id, step_key, event_type, actor_type, actor_id, note, payload_json, created_at
       FROM workflow_events
       WHERE request_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(requestId, safeLimit) as WorkflowEventRow[];

  return rows.map(mapWorkflowEventRow);
}

export function createRequestArtifact(input: CreateRequestArtifactInput): RequestArtifactRecord {
  const request = getChangeRequest(input.requestId);
  if (!request) {
    throw new Error('CHANGE_REQUEST_NOT_FOUND');
  }

  const id = normalizeText(input.id) || randomUUID();
  const now = new Date().toISOString();
  const kind = normalizeText(input.kind) || 'file';
  const name = normalizeText(input.name);
  const mimeType = normalizeText(input.mimeType) || 'application/octet-stream';
  const storagePath = normalizeText(input.storagePath);

  if (!name) {
    throw new Error('ARTIFACT_NAME_REQUIRED');
  }
  if (!storagePath) {
    throw new Error('ARTIFACT_STORAGE_PATH_REQUIRED');
  }

  getDb()
    .prepare(
      `INSERT INTO request_artifacts (
         id, agent_run_id, request_id, workflow_run_id, execution_id, kind, name, description,
         mime_type, storage_path, size_bytes, metadata_json, created_by, created_at, updated_at
       ) VALUES (
         @id, @agentRunId, @requestId, @workflowRunId, @executionId, @kind, @name, @description,
         @mimeType, @storagePath, @sizeBytes, @metadataJson, @createdBy, @createdAt, @updatedAt
       )`,
    )
    .run({
      id,
      agentRunId: input.agentRunId ?? null,
      requestId: input.requestId,
      workflowRunId: input.workflowRunId ?? null,
      executionId: input.executionId ?? null,
      kind,
      name,
      description: normalizeText(input.description) || null,
      mimeType,
      storagePath,
      sizeBytes: Math.max(0, Math.trunc(input.sizeBytes)),
      metadataJson: JSON.stringify(input.metadata ?? {}),
      createdBy: normalizeText(input.createdBy) || 'system',
      createdAt: now,
      updatedAt: now,
    });

  const artifact = getRequestArtifact(id);
  if (!artifact) {
    throw new Error('ARTIFACT_CREATE_FAILED');
  }

  return artifact;
}

export function getRequestArtifact(id: string): RequestArtifactRecord | null {
  const row = getDb()
    .prepare(
      `SELECT id, request_id, workflow_run_id, execution_id, kind, name, description,
              mime_type, storage_path, size_bytes, metadata_json, created_by, created_at, updated_at
       FROM request_artifacts
       WHERE id = ?`,
    )
    .get(id) as RequestArtifactRow | undefined;

  return row ? mapRequestArtifactRow(row) : null;
}

export function getRequestArtifactByName(requestId: string, name: string): RequestArtifactRecord | null {
  const row = getDb()
    .prepare(
      `SELECT id, request_id, workflow_run_id, execution_id, kind, name, description,
              mime_type, storage_path, size_bytes, metadata_json, created_by, created_at, updated_at
       FROM request_artifacts
       WHERE request_id = ? AND name = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get(requestId, name) as RequestArtifactRow | undefined;

  return row ? mapRequestArtifactRow(row) : null;
}

export function deleteRequestArtifact(id: string) {
  getDb().prepare('DELETE FROM request_artifacts WHERE id = ?').run(id);
}

export function listRequestArtifacts(requestId: string, limit = 100): RequestArtifactRecord[] {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const rows = getDb()
    .prepare(
      `SELECT id, request_id, workflow_run_id, execution_id, kind, name, description,
              mime_type, storage_path, size_bytes, metadata_json, created_by, created_at, updated_at
       FROM request_artifacts
       WHERE request_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(requestId, safeLimit) as RequestArtifactRow[];

  return rows.map(mapRequestArtifactRow);
}

export function upsertRequestExternalRef(input: UpsertRequestExternalRefInput): RequestExternalRefRecord {
  const request = getChangeRequest(input.requestId);
  if (!request) {
    throw new Error('CHANGE_REQUEST_NOT_FOUND');
  }

  const provider = normalizeText(input.provider);
  const kind = normalizeText(input.kind);
  const url = normalizeExternalRefUrl(input.url);
  if (!provider || !kind || !url) {
    throw new Error('EXTERNAL_REF_PROVIDER_KIND_URL_REQUIRED');
  }

  const now = new Date().toISOString();
  const existing = getDb()
    .prepare('SELECT id, created_at FROM request_external_refs WHERE request_id = ? AND url = ?')
    .get(input.requestId, url) as { id: string; created_at: string } | undefined;
  const inputId = normalizeText(input.id);
  if (existing && inputId && inputId !== existing.id) {
    throw new Error('EXTERNAL_REF_ID_URL_CONFLICT');
  }
  const id = existing?.id || inputId || randomUUID();
  const createdAt = existing?.created_at ?? now;

  getDb()
    .prepare(
      `INSERT INTO request_external_refs (
         id, request_id, provider, kind, external_id, title, url, state,
         metadata_json, created_by, created_at, updated_at
       ) VALUES (
         @id, @requestId, @provider, @kind, @externalId, @title, @url, @state,
         @metadataJson, @createdBy, @createdAt, @updatedAt
       )
       ON CONFLICT(request_id, url) DO UPDATE SET
         provider = excluded.provider,
         kind = excluded.kind,
         external_id = excluded.external_id,
         title = excluded.title,
         state = excluded.state,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
    )
    .run({
      id,
      requestId: input.requestId,
      provider,
      kind,
      externalId: normalizeText(input.externalId) || null,
      title: normalizeText(input.title) || null,
      url,
      state: normalizeText(input.state) || null,
      metadataJson: JSON.stringify(input.metadata ?? {}),
      createdBy: normalizeText(input.createdBy) || 'agent',
      createdAt,
      updatedAt: now,
    });

  const ref = getRequestExternalRef(id) ?? getRequestExternalRefByUrl(input.requestId, url);
  if (!ref) {
    throw new Error('EXTERNAL_REF_UPSERT_FAILED');
  }
  return ref;
}

export function getRequestExternalRef(id: string): RequestExternalRefRecord | null {
  const row = getDb()
    .prepare(
      `SELECT id, request_id, provider, kind, external_id, title, url, state,
              metadata_json, created_by, created_at, updated_at
       FROM request_external_refs
       WHERE id = ?`,
    )
    .get(id) as RequestExternalRefRow | undefined;

  return row ? mapRequestExternalRefRow(row) : null;
}

export function getRequestExternalRefByUrl(requestId: string, url: string): RequestExternalRefRecord | null {
  const row = getDb()
    .prepare(
      `SELECT id, request_id, provider, kind, external_id, title, url, state,
              metadata_json, created_by, created_at, updated_at
       FROM request_external_refs
       WHERE request_id = ? AND url = ?`,
    )
    .get(requestId, url) as RequestExternalRefRow | undefined;

  return row ? mapRequestExternalRefRow(row) : null;
}

export function deleteRequestExternalRef(id: string) {
  getDb().prepare('DELETE FROM request_external_refs WHERE id = ?').run(id);
}

export function listRequestExternalRefs(requestId: string, limit = 100): RequestExternalRefRecord[] {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const rows = getDb()
    .prepare(
      `SELECT id, request_id, provider, kind, external_id, title, url, state,
              metadata_json, created_by, created_at, updated_at
       FROM request_external_refs
       WHERE request_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(requestId, safeLimit) as RequestExternalRefRow[];

  return rows.map(mapRequestExternalRefRow);
}

export function upsertTask(input: UpsertTaskInput): TaskRecord {
  const db = getDb();
  const now = new Date().toISOString();
  const key = normalizeText(input.key);
  const name = normalizeText(input.name);

  if (!key || !name) {
    throw new Error('TASK_KEY_AND_NAME_REQUIRED');
  }

  const existing = db.prepare('SELECT id, created_at FROM tasks WHERE key = ?').get(key) as
    | { id: string; created_at: string }
    | undefined;
  const id = existing?.id ?? randomUUID();
  const createdAt = existing?.created_at ?? now;

  db.prepare(
    `INSERT INTO tasks (
       id, key, name, description, enabled, trigger_type, schedule_cron, timezone, task_type,
       input_config_json, instruction_config_json, output_config_json, agent_config_json, created_at, updated_at
     ) VALUES (
       @id, @key, @name, @description, @enabled, @triggerType, @scheduleCron, @timezone, @taskType,
       @inputConfigJson, @instructionConfigJson, @outputConfigJson, @agentConfigJson, @createdAt, @updatedAt
     )
     ON CONFLICT(key) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       enabled = excluded.enabled,
       trigger_type = excluded.trigger_type,
       schedule_cron = excluded.schedule_cron,
       timezone = excluded.timezone,
       task_type = excluded.task_type,
       input_config_json = excluded.input_config_json,
       instruction_config_json = excluded.instruction_config_json,
       output_config_json = excluded.output_config_json,
       agent_config_json = excluded.agent_config_json,
       updated_at = excluded.updated_at`,
  ).run({
    id,
    key,
    name,
    description: normalizeText(input.description) || null,
    enabled: input.enabled ? 1 : 0,
    triggerType: normalizeText(input.triggerType) || 'schedule',
    scheduleCron: normalizeText(input.scheduleCron) || null,
    timezone: normalizeText(input.timezone) || 'UTC',
    taskType: normalizeText(input.taskType) || 'builtin',
    inputConfigJson: JSON.stringify(input.inputConfig ?? {}),
    instructionConfigJson: JSON.stringify(input.instructionConfig ?? {}),
    outputConfigJson: JSON.stringify(input.outputConfig ?? {}),
    agentConfigJson: JSON.stringify(input.agentConfig ?? {}),
    createdAt,
    updatedAt: now,
  });

  const task = getTaskByKey(key);
  if (!task) {
    throw new Error('TASK_UPSERT_FAILED');
  }
  return task;
}

export function getTaskByKey(key: string): TaskRecord | null {
  const row = getDb().prepare('SELECT * FROM tasks WHERE key = ?').get(key) as TaskRow | undefined;
  return row ? mapTaskRow(row) : null;
}

export function deleteCustomTaskByKey(key: string): TaskRecord | null {
  const task = getTaskByKey(key);
  if (!task) {
    return null;
  }
  if (task.taskType === 'builtin') {
    throw new Error('TASK_DELETE_SYSTEM_DEFAULT');
  }
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  return task;
}

export function upsertTaskScript(input: UpsertTaskScriptInput): TaskScriptRecord {
  const db = getDb();
  const now = new Date().toISOString();
  const key = normalizeText(input.key);
  const name = normalizeText(input.name);
  const runtime = normalizeText(input.runtime) || 'node-esm';
  const storagePath = normalizeText(input.storagePath);
  const checksum = normalizeText(input.checksum);

  if (!key || !name) {
    throw new Error('TASK_SCRIPT_KEY_AND_NAME_REQUIRED');
  }
  if (!storagePath || !checksum) {
    throw new Error('TASK_SCRIPT_STORAGE_AND_CHECKSUM_REQUIRED');
  }

  const existing = db.prepare('SELECT id, enabled, timeout_ms, created_at FROM task_scripts WHERE key = ?').get(key) as
    | { id: string; enabled: number; timeout_ms: number | null; created_at: string }
    | undefined;
  const id = existing?.id ?? randomUUID();
  const createdAt = existing?.created_at ?? now;
  const timeoutMs = input.timeoutMs === undefined
    ? existing?.timeout_ms ?? null
    : typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs)
      ? Math.max(1_000, Math.min(3_600_000, Math.trunc(input.timeoutMs)))
      : null;
  const enabled = input.enabled === undefined ? existing?.enabled ?? 0 : input.enabled ? 1 : 0;

  db.prepare(
    `INSERT INTO task_scripts (
       id, key, name, description, runtime, enabled, storage_path, checksum, timeout_ms, created_at, updated_at
     ) VALUES (
       @id, @key, @name, @description, @runtime, @enabled, @storagePath, @checksum, @timeoutMs, @createdAt, @updatedAt
     )
     ON CONFLICT(key) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       runtime = excluded.runtime,
       enabled = excluded.enabled,
       storage_path = excluded.storage_path,
       checksum = excluded.checksum,
       timeout_ms = excluded.timeout_ms,
       updated_at = excluded.updated_at`,
  ).run({
    id,
    key,
    name,
    description: normalizeText(input.description) || null,
    runtime,
    enabled,
    storagePath,
    checksum,
    timeoutMs,
    createdAt,
    updatedAt: now,
  });

  const script = getTaskScriptByKey(key);
  if (!script) {
    throw new Error('TASK_SCRIPT_UPSERT_FAILED');
  }
  return script;
}

export function getTaskScriptByKey(key: string): TaskScriptRecord | null {
  const row = getDb().prepare('SELECT * FROM task_scripts WHERE key = ?').get(key) as TaskScriptRow | undefined;
  return row ? mapTaskScriptRow(row) : null;
}

export function deleteTaskScriptByKey(key: string): TaskScriptRecord | null {
  const script = getTaskScriptByKey(key);
  if (!script) {
    return null;
  }
  getDb().prepare('DELETE FROM task_scripts WHERE id = ?').run(script.id);
  return script;
}

export function upsertHook(input: UpsertHookInput): HookRecord {
  const db = getDb();
  const now = new Date().toISOString();
  const key = normalizeText(input.key);
  const name = normalizeText(input.name);
  const workflowKey = normalizeText(input.workflowKey);

  if (!key || !name || !workflowKey) {
    throw new Error('HOOK_KEY_NAME_AND_WORKFLOW_REQUIRED');
  }
  const workflow = getWorkflowByKey(workflowKey);
  if (!workflow) {
    throw new Error('WORKFLOW_NOT_FOUND');
  }

  const existing = db
    .prepare(
      `SELECT id, created_at, system_default, enabled, auth_mode, auth_config_json, request_template_json, auto_run_json
       FROM hooks
       WHERE key = ?`,
    )
    .get(key) as
    | {
        id: string;
        created_at: string;
        system_default: number;
        enabled: number;
        auth_mode: string;
        auth_config_json: string;
        request_template_json: string;
        auto_run_json: string;
      }
    | undefined;
  const id = existing?.id ?? randomUUID();
  const createdAt = existing?.created_at ?? now;
  const systemDefault = existing?.system_default === 1 || input.systemDefault === true;
  const enabled = input.enabled === undefined ? existing?.enabled ?? 0 : input.enabled ? 1 : 0;
  const authMode =
    input.authMode === undefined
      ? existing?.auth_mode ?? 'service-token'
      : normalizeText(input.authMode) || 'service-token';
  if (!new Set(['service-token', 'interface-token']).has(authMode)) {
    throw new Error('HOOK_AUTH_MODE_INVALID');
  }
  if (authMode === 'interface-token') {
    const authConfig = input.authConfig ?? parseJsonValue<Record<string, unknown>>(existing?.auth_config_json ?? '{}', {});
    const interfaceKey = normalizeText(authConfig.interfaceKey ?? authConfig.interface_key);
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(interfaceKey)) {
      throw new Error('HOOK_INTERFACE_KEY_REQUIRED');
    }
  }
  const authConfigJson =
    input.authConfig === undefined ? existing?.auth_config_json ?? '{}' : JSON.stringify(input.authConfig);
  const requestTemplateJson =
    input.requestTemplate === undefined ? existing?.request_template_json ?? '{}' : JSON.stringify(input.requestTemplate);
  const autoRunJson =
    input.autoRun === undefined ? existing?.auto_run_json ?? '{}' : JSON.stringify(input.autoRun);

  db.prepare(
    `INSERT INTO hooks (
       id, key, name, description, enabled, workflow_key, auth_mode, auth_config_json, request_template_json,
       auto_run_json, system_default, last_triggered_at, created_at, updated_at
     ) VALUES (
       @id, @key, @name, @description, @enabled, @workflowKey, @authMode, @authConfigJson, @requestTemplateJson,
       @autoRunJson, @systemDefault, @lastTriggeredAt, @createdAt, @updatedAt
     )
     ON CONFLICT(key) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       enabled = excluded.enabled,
       workflow_key = excluded.workflow_key,
       auth_mode = excluded.auth_mode,
       auth_config_json = excluded.auth_config_json,
       request_template_json = excluded.request_template_json,
       auto_run_json = excluded.auto_run_json,
       updated_at = excluded.updated_at`,
  ).run({
    id,
    key,
    name,
    description: normalizeText(input.description) || null,
    enabled,
    workflowKey,
    authMode,
    authConfigJson,
    requestTemplateJson,
    autoRunJson,
    systemDefault: systemDefault ? 1 : 0,
    lastTriggeredAt: null,
    createdAt,
    updatedAt: now,
  });

  const hook = getHookByKey(key);
  if (!hook) {
    throw new Error('HOOK_UPSERT_FAILED');
  }
  return hook;
}

export function getHookByKey(key: string): HookRecord | null {
  const row = getDb().prepare('SELECT * FROM hooks WHERE key = ?').get(key) as HookRow | undefined;
  return row ? mapHookRow(row) : null;
}

export function listHooks(): HookRecord[] {
  const rows = getDb().prepare('SELECT * FROM hooks ORDER BY key ASC').all() as HookRow[];
  return rows.map(mapHookRow);
}

export function markHookTriggered(key: string, triggeredAt = new Date().toISOString()): HookRecord | null {
  getDb().prepare('UPDATE hooks SET last_triggered_at = ?, updated_at = ? WHERE key = ?').run(triggeredAt, triggeredAt, key);
  return getHookByKey(key);
}

export function createHookRun(input: CreateHookRunInput): HookRunRecord {
  const now = new Date().toISOString();
  const startedAt = normalizeText(input.startedAt) || now;
  const id = randomUUID();
  const hookKey = normalizeText(input.hookKey);
  if (!hookKey) {
    throw new Error('HOOK_RUN_KEY_REQUIRED');
  }
  const source = normalizeText(input.source) || 'hook';
  const hookName = normalizeText(input.hookName) || null;
  const workflowKey = normalizeText(input.workflowKey) || null;
  const workflow = workflowKey ? getWorkflowByKey(workflowKey) : null;
  const executor = workflowAgentExecutor(workflow?.definition, null);
  const executorResolution = executor.resolution === 'workflow-default'
    ? 'hook-workflow-default'
    : executor.resolution;
  const agentRun = createAgentRun({
    kind: 'hook',
    status: 'running',
    idempotencyKey: `hook:${id}`,
    hookKey,
    agentProfileId: executor.profileId,
    agentProfileVersion: executor.profileVersion,
    executionMode: executor.executionMode,
    executorResolution,
    accountabilitySnapshot: buildAccountabilitySnapshot({
      definitionType: workflow ? 'workflow' : null,
      definitionId: workflow?.id ?? null,
      definitionKey: workflow?.key ?? workflowKey,
      definitionVersion: workflow?.version ?? null,
      executorProfileId: executor.profileId,
      executorProfileKey: executor.profileKey,
      executorProfileVersion: executor.profileVersion,
      resolution: executorResolution,
    }),
    source,
    input: {
      hookRunId: id,
      hookKey,
      hookName,
      workflowKey,
      payload: input.payload ?? {},
    },
    startedAt,
  });
  getDb().prepare(
    `INSERT INTO hook_runs (
       id, agent_run_id, hook_id, hook_key, hook_name, workflow_key, status, source, payload_json,
       result_json, started_at, created_at, updated_at
     ) VALUES (
       @id, @agentRunId, @hookId, @hookKey, @hookName, @workflowKey, 'running', @source, @payloadJson,
       '{}', @startedAt, @createdAt, @updatedAt
     )`,
  ).run({
    id,
    agentRunId: agentRun?.id ?? null,
    hookId: normalizeText(input.hookId) || null,
    hookKey,
    hookName,
    workflowKey,
    source,
    payloadJson: JSON.stringify(input.payload ?? {}),
    startedAt,
    createdAt: now,
    updatedAt: now,
  });
  const run = getHookRun(id);
  if (!run) {
    throw new Error('HOOK_RUN_CREATE_FAILED');
  }
  return run;
}

export function getHookRun(id: string): HookRunRecord | null {
  const row = getDb().prepare('SELECT * FROM hook_runs WHERE id = ?').get(id) as HookRunRow | undefined;
  return row ? mapHookRunRow(row) : null;
}

export function updateHookRun(id: string, input: UpdateHookRunInput): HookRunRecord | null {
  const current = getHookRun(id);
  if (!current) {
    return null;
  }
  const now = new Date().toISOString();
  const status = normalizeText(input.status) || current.status;
  const finishedAt =
    input.finishedAt === undefined
      ? current.finishedAt
      : normalizeText(input.finishedAt) || (status === 'running' ? null : now);
  getDb().prepare(
    `UPDATE hook_runs
     SET status = @status,
         request_id = @requestId,
         request_number = @requestNumber,
         request_title = @requestTitle,
         auto_start_queued = @autoStartQueued,
         auto_start_started = @autoStartStarted,
         error_message = @errorMessage,
         result_json = @resultJson,
         finished_at = @finishedAt,
         updated_at = @updatedAt
     WHERE id = @id`,
  ).run({
    id,
    status,
    requestId: input.requestId === undefined ? current.requestId : normalizeText(input.requestId) || null,
    requestNumber: input.requestNumber === undefined ? current.requestNumber : input.requestNumber,
    requestTitle: input.requestTitle === undefined ? current.requestTitle : normalizeText(input.requestTitle) || null,
    autoStartQueued:
      input.autoStartQueued === undefined ? (current.autoStartQueued ? 1 : 0) : input.autoStartQueued ? 1 : 0,
    autoStartStarted:
      input.autoStartStarted === undefined ? (current.autoStartStarted ? 1 : 0) : input.autoStartStarted ? 1 : 0,
    errorMessage: input.errorMessage === undefined ? current.errorMessage : normalizeText(input.errorMessage) || null,
    resultJson: input.result === undefined ? JSON.stringify(current.result) : JSON.stringify(input.result),
    finishedAt,
    updatedAt: now,
  });
  if (current.agentRunId) {
    const requestId = input.requestId === undefined ? current.requestId : normalizeText(input.requestId) || null;
    const requestNumber = input.requestNumber === undefined ? current.requestNumber : input.requestNumber;
    const requestTitle = input.requestTitle === undefined ? current.requestTitle : normalizeText(input.requestTitle) || null;
    const result = input.result === undefined ? current.result : input.result;
    updateAgentRun(current.agentRunId, {
      status:
        status === 'succeeded'
          ? 'succeeded'
          : status === 'failed'
            ? 'failed'
            : status === 'canceled'
              ? 'canceled'
              : 'running',
      requestId,
      result: {
        ...result,
        hookRunId: current.id,
        hookKey: current.hookKey,
        hookName: current.hookName,
        workflowKey: current.workflowKey,
        requestNumber,
        requestTitle,
        autoStartQueued: input.autoStartQueued === undefined ? current.autoStartQueued : input.autoStartQueued,
        autoStartStarted: input.autoStartStarted === undefined ? current.autoStartStarted : input.autoStartStarted,
      },
      errorMessage: input.errorMessage === undefined ? current.errorMessage : normalizeText(input.errorMessage) || null,
      finishedAt: status === 'running' ? null : finishedAt,
    });
  }
  return getHookRun(id);
}

export function listHookRuns(input: { hookKey?: string | null; limit?: number } = {}): HookRunRecord[] {
  const limit = Math.max(1, Math.min(Number(input.limit ?? 50), 200));
  const hookKey = normalizeText(input.hookKey);
  const db = getDb();
  const rows = hookKey
    ? db
        .prepare('SELECT * FROM hook_runs WHERE hook_key = ? ORDER BY created_at DESC LIMIT ?')
        .all(hookKey, limit)
    : db.prepare('SELECT * FROM hook_runs ORDER BY created_at DESC LIMIT ?').all(limit);
  return (rows as HookRunRow[]).map(mapHookRunRow);
}

export function deleteCustomHookByKey(key: string): HookRecord | null {
  const hook = getHookByKey(key);
  if (!hook) {
    return null;
  }
  if (hook.systemDefault) {
    throw new Error('HOOK_DELETE_SYSTEM_DEFAULT');
  }
  getDb().prepare('DELETE FROM hooks WHERE id = ?').run(hook.id);
  return hook;
}

export function listTasks(): TaskRecord[] {
  const rows = getDb().prepare('SELECT * FROM tasks ORDER BY key ASC').all() as TaskRow[];
  return rows.map(mapTaskRow);
}

export function listTaskScripts(): TaskScriptRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, key, name, description, runtime, enabled, storage_path, checksum, timeout_ms, created_at, updated_at
       FROM task_scripts
       ORDER BY key ASC`,
    )
    .all() as TaskScriptRow[];
  return rows.map(mapTaskScriptRow);
}

export function createTaskRun(input: CreateTaskRunInput): TaskRunRecord {
  const task = getTaskByKey(input.taskKey);
  if (!task) {
    throw new Error(`TASK_NOT_FOUND:${input.taskKey}`);
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const status = normalizeText(input.status) || 'running';
  const triggerSource = normalizeText(input.triggerSource) || 'manual';
  const startedAt = input.startedAt ?? now;
  const outputSnapshot = input.outputSnapshot ?? {};
  const artifactRefs = input.artifactRefs ?? [];
  const resultSummary = normalizeText(input.resultSummary) || null;
  const errorMessage = normalizeText(input.errorMessage) || null;
  const finishedAt = status === 'running' || status === 'queued' ? null : now;
  const usesAgentExecutor = taskUsesAgentExecutor(task.taskType, task.agentConfig);
  const executor = usesAgentExecutor ? taskAgentExecutor(task.agentConfig) : null;
  const executorResolution = executor?.resolution ?? 'not-applicable';
  const agentRun = createAgentRun({
    kind: 'task',
    status,
    idempotencyKey: `task:${id}`,
    taskKey: task.key,
    agentProfileId: executor?.profileId ?? null,
    agentProfileVersion: executor?.profileVersion ?? null,
    executionMode: executor?.executionMode ?? null,
    executorResolution,
    accountabilitySnapshot: buildAccountabilitySnapshot({
      definitionType: 'task',
      definitionId: task.id,
      definitionKey: task.key,
      executorProfileId: executor?.profileId ?? null,
      executorProfileKey: executor?.profileKey ?? null,
      executorProfileVersion: executor?.profileVersion ?? null,
      resolution: executorResolution,
    }),
    source: triggerSource,
    input: {
      taskRunId: id,
      taskKey: task.key,
      taskName: task.name,
      triggerSource,
      inputSnapshot: input.inputSnapshot ?? {},
    },
    result: {
      taskRunId: id,
      taskKey: task.key,
      taskName: task.name,
      triggerSource,
      resultSummary,
      outputSnapshot,
      artifactRefs,
    },
    trace: extractTraceFromTaskOutputSnapshot(outputSnapshot),
    errorMessage,
    startedAt,
    finishedAt,
  });

  getDb().prepare(
    `INSERT INTO task_runs (
       id, agent_run_id, task_id, status, trigger_source, started_at, finished_at, result_summary, error_message,
       input_snapshot_json, output_snapshot_json, artifact_refs_json, created_at, updated_at
     ) VALUES (
       @id, @agentRunId, @taskId, @status, @triggerSource, @startedAt, @finishedAt, @resultSummary, @errorMessage,
       @inputSnapshotJson, @outputSnapshotJson, @artifactRefsJson, @createdAt, @updatedAt
     )`,
  ).run({
    id,
    agentRunId: agentRun?.id ?? null,
    taskId: task.id,
    status,
    triggerSource,
    startedAt,
    finishedAt,
    resultSummary,
    errorMessage,
    inputSnapshotJson: JSON.stringify(input.inputSnapshot ?? {}),
    outputSnapshotJson: JSON.stringify(outputSnapshot),
    artifactRefsJson: JSON.stringify(artifactRefs),
    createdAt: now,
    updatedAt: now,
  });

  const run = getTaskRun(id);
  if (!run) {
    throw new Error('TASK_RUN_CREATE_FAILED');
  }
  return run;
}

export function getTaskRun(id: string): TaskRunRecord | null {
  const row = getDb().prepare(
    `SELECT task_runs.*, tasks.key AS task_key, tasks.name AS task_name
     FROM task_runs
     LEFT JOIN tasks ON tasks.id = task_runs.task_id
     WHERE task_runs.id = ?`,
  ).get(id) as TaskRunRow | undefined;
  return row ? mapTaskRunRow(row) : null;
}

export function updateTaskRun(id: string, input: UpdateTaskRunInput): TaskRunRecord {
  const current = getTaskRun(id);
  if (!current) {
    throw new Error('TASK_RUN_NOT_FOUND');
  }

  const now = new Date().toISOString();
  const nextOutputSnapshot = input.outputSnapshot ?? current.outputSnapshot;
  const nextArtifactRefs = input.artifactRefs ?? current.artifactRefs;
  const nextTrace = extractTraceFromTaskOutputSnapshot(nextOutputSnapshot);

  getDb().prepare(
    `UPDATE task_runs
     SET status = @status,
         finished_at = @finishedAt,
         result_summary = @resultSummary,
         error_message = @errorMessage,
         input_snapshot_json = @inputSnapshotJson,
         output_snapshot_json = @outputSnapshotJson,
         artifact_refs_json = @artifactRefsJson,
         updated_at = @updatedAt
     WHERE id = @id`,
  ).run({
    id,
    status: normalizeText(input.status) || current.status,
    finishedAt: input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
    resultSummary: input.resultSummary === undefined ? current.resultSummary : normalizeText(input.resultSummary) || null,
    errorMessage: input.errorMessage === undefined ? current.errorMessage : normalizeText(input.errorMessage) || null,
    inputSnapshotJson: JSON.stringify(input.inputSnapshot ?? current.inputSnapshot),
    outputSnapshotJson: JSON.stringify(nextOutputSnapshot),
    artifactRefsJson: JSON.stringify(nextArtifactRefs),
    updatedAt: now,
  });
  if (current.agentRunId) {
    const status = normalizeText(input.status) || current.status;
    updateAgentRun(current.agentRunId, {
      status:
        status === 'succeeded'
          ? 'succeeded'
          : status === 'failed'
            ? 'failed'
            : status === 'canceled'
              ? 'canceled'
              : 'running',
      result: {
        taskRunId: current.id,
        taskKey: current.taskKey,
        taskName: current.taskName,
        triggerSource: current.triggerSource,
        resultSummary:
          input.resultSummary === undefined ? current.resultSummary : normalizeText(input.resultSummary) || null,
        outputSnapshot: nextOutputSnapshot,
        artifactRefs: nextArtifactRefs,
      },
      trace: nextTrace,
      errorMessage: input.errorMessage === undefined ? current.errorMessage : normalizeText(input.errorMessage) || null,
      finishedAt: input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
    });
  }

  const updated = getTaskRun(id);
  if (!updated) {
    throw new Error('TASK_RUN_UPDATE_FAILED');
  }
  return updated;
}

export function listTaskRuns(input: { taskKey?: string; limit?: number } = {}): TaskRunRecord[] {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const taskKey = normalizeText(input.taskKey);
  const rows = taskKey
    ? getDb().prepare(
        `SELECT task_runs.*, tasks.key AS task_key, tasks.name AS task_name
         FROM task_runs
         JOIN tasks ON tasks.id = task_runs.task_id
         WHERE tasks.key = ?
         ORDER BY task_runs.created_at DESC
         LIMIT ?`,
      ).all(taskKey, limit) as TaskRunRow[]
    : getDb().prepare(
        `SELECT task_runs.*, tasks.key AS task_key, tasks.name AS task_name
         FROM task_runs
         LEFT JOIN tasks ON tasks.id = task_runs.task_id
         ORDER BY task_runs.created_at DESC
         LIMIT ?`,
      ).all(limit) as TaskRunRow[];

  return rows.map(mapTaskRunRow);
}
