import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

import {
  workflowAgentExecutor,
  taskAgentExecutor,
  taskUsesAgentExecutor,
  type AgentExecutorResolution,
} from './agent-executors';
import { getDb } from './db';

export const accountabilityTargetTypes = ['agent_profile', 'workflow', 'task'] as const;
export type AccountabilityTargetType = (typeof accountabilityTargetTypes)[number];
export type AccountabilityDomainStatus = 'active' | 'archived';

export type AccountabilityDomainSteward = {
  userId: string;
  displayName: string | null;
};

export type AccountabilityDomainRecord = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: AccountabilityDomainStatus;
  systemKey: string | null;
  governanceRef: Record<string, unknown>;
  version: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  stewards: AccountabilityDomainSteward[];
  createdAt: string;
  updatedAt: string;
};

export type AccountabilityDomainAssignment = {
  targetType: AccountabilityTargetType;
  targetId: string;
  domainId: string;
  domainKey: string;
  domainName: string;
  assignedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

type DomainRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: AccountabilityDomainStatus;
  system_key: string | null;
  governance_ref_json: string;
  version: number;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

function parseRecord(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeKey(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
    : '';
}

function normalizeText(value: unknown, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function stewardRows(domainId: string, db: Database.Database): AccountabilityDomainSteward[] {
  return (db.prepare(`
    SELECT ads.user_id, p.display_name
    FROM accountability_domain_stewards ads
    LEFT JOIN profiles p ON p.user_id = ads.user_id
    WHERE ads.domain_id = ?
    ORDER BY COALESCE(p.display_name, ads.user_id)
  `).all(domainId) as Array<{ user_id: string; display_name: string | null }>).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
  }));
}

function mapDomain(row: DomainRow, db: Database.Database): AccountabilityDomainRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    systemKey: row.system_key,
    governanceRef: parseRecord(row.governance_ref_json),
    version: row.version,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    stewards: stewardRows(row.id, db),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAccountabilityDomains(
  input: { includeArchived?: boolean } = {},
  db: Database.Database = getDb(),
) {
  const rows = db.prepare(`
    SELECT * FROM accountability_domains
    ${input.includeArchived ? '' : "WHERE status = 'active'"}
    ORDER BY CASE WHEN system_key IS NOT NULL THEN 0 ELSE 1 END, name, key
  `).all() as DomainRow[];
  return rows.map((row) => mapDomain(row, db));
}

export function getAccountabilityDomain(key: string, db: Database.Database = getDb()) {
  const row = db.prepare('SELECT * FROM accountability_domains WHERE key = ?')
    .get(normalizeKey(key)) as DomainRow | undefined;
  return row ? mapDomain(row, db) : null;
}

export function upsertAccountabilityDomain(input: {
  key: string;
  name: string;
  description?: string | null;
  status?: AccountabilityDomainStatus;
  governanceRef?: Record<string, unknown>;
  stewardUserIds?: string[];
  actorUserId?: string | null;
}, db: Database.Database = getDb()) {
  const key = normalizeKey(input.key);
  const name = normalizeText(input.name, 160);
  if (!key || !name) throw new Error('ACCOUNTABILITY_DOMAIN_KEY_AND_NAME_REQUIRED');
  const existing = getAccountabilityDomain(key, db);
  if (existing?.systemKey && input.status === 'archived') throw new Error('ACCOUNTABILITY_DOMAIN_SYSTEM_ARCHIVE_FORBIDDEN');
  const now = new Date().toISOString();
  const id = existing?.id ?? randomUUID();
  const status = input.status ?? existing?.status ?? 'active';
  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO accountability_domains (
        id, key, name, description, status, system_key, governance_ref_json, version,
        created_by_user_id, updated_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        status = excluded.status,
        governance_ref_json = excluded.governance_ref_json,
        version = accountability_domains.version + 1,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = excluded.updated_at
    `).run(
      id, key, name, input.description === undefined ? existing?.description ?? null : normalizeText(input.description) || null,
      status, existing?.systemKey ?? null, JSON.stringify(input.governanceRef ?? existing?.governanceRef ?? {}),
      existing?.version ?? 1, existing?.createdByUserId ?? input.actorUserId ?? null, input.actorUserId ?? null,
      existing?.createdAt ?? now, now,
    );
    if (input.stewardUserIds) {
      const userIds = Array.from(new Set(input.stewardUserIds.map((value) => normalizeText(value, 200)).filter(Boolean)));
      for (const userId of userIds) {
        if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) {
          throw new Error(`ACCOUNTABILITY_DOMAIN_STEWARD_NOT_FOUND:${userId}`);
        }
      }
      db.prepare('DELETE FROM accountability_domain_stewards WHERE domain_id = ?').run(id);
      const insert = db.prepare(`
        INSERT INTO accountability_domain_stewards (domain_id, user_id, created_by_user_id, created_at)
        VALUES (?, ?, ?, ?)
      `);
      userIds.forEach((userId) => insert.run(id, userId, input.actorUserId ?? null, now));
    }
  });
  transaction();
  return getAccountabilityDomain(key, db)!;
}

function targetTable(targetType: AccountabilityTargetType) {
  if (targetType === 'agent_profile') return 'agent_profiles';
  if (targetType === 'workflow') return 'workflows';
  return 'tasks';
}

export function assignAccountabilityDomain(input: {
  targetType: AccountabilityTargetType;
  targetKey: string;
  domainKey: string;
  actorUserId?: string | null;
}, db: Database.Database = getDb()) {
  if (!accountabilityTargetTypes.includes(input.targetType)) throw new Error('ACCOUNTABILITY_TARGET_TYPE_INVALID');
  const targetKey = normalizeText(input.targetKey, 160);
  const target = db.prepare(`SELECT id FROM ${targetTable(input.targetType)} WHERE key = ?`)
    .get(targetKey) as { id: string } | undefined;
  if (!target) throw new Error(`ACCOUNTABILITY_TARGET_NOT_FOUND:${input.targetType}:${targetKey}`);
  const domain = getAccountabilityDomain(input.domainKey, db);
  if (!domain) throw new Error(`ACCOUNTABILITY_DOMAIN_NOT_FOUND:${input.domainKey}`);
  if (domain.status !== 'active') throw new Error(`ACCOUNTABILITY_DOMAIN_NOT_ACTIVE:${domain.key}`);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO accountability_domain_assignments (
      target_type, target_id, domain_id, assigned_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(target_type, target_id) DO UPDATE SET
      domain_id = excluded.domain_id,
      assigned_by_user_id = excluded.assigned_by_user_id,
      updated_at = excluded.updated_at
  `).run(input.targetType, target.id, domain.id, input.actorUserId ?? null, now, now);
  return getAccountabilityAssignment(input.targetType, target.id, db)!;
}

export function getAccountabilityAssignment(
  targetType: AccountabilityTargetType,
  targetId: string,
  db: Database.Database = getDb(),
): AccountabilityDomainAssignment | null {
  const row = db.prepare(`
    SELECT ada.target_type, ada.target_id, ada.domain_id, ada.assigned_by_user_id, ada.created_at, ada.updated_at,
           ad.key AS domain_key, ad.name AS domain_name
    FROM accountability_domain_assignments ada
    JOIN accountability_domains ad ON ad.id = ada.domain_id
    WHERE ada.target_type = ? AND ada.target_id = ?
  `).get(targetType, targetId) as {
    target_type: AccountabilityTargetType; target_id: string; domain_id: string; assigned_by_user_id: string | null;
    created_at: string; updated_at: string; domain_key: string; domain_name: string;
  } | undefined;
  return row ? {
    targetType: row.target_type, targetId: row.target_id, domainId: row.domain_id,
    domainKey: row.domain_key, domainName: row.domain_name, assignedByUserId: row.assigned_by_user_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  } : null;
}

export function buildAccountabilitySnapshot(input: {
  definitionType?: AccountabilityTargetType | null;
  definitionId?: string | null;
  definitionKey?: string | null;
  definitionVersion?: number | null;
  executorProfileId?: string | null;
  executorProfileKey?: string | null;
  executorProfileVersion?: number | null;
  resolution: AgentExecutorResolution;
}, db: Database.Database = getDb()) {
  const definition = input.definitionType && input.definitionId
    ? getAccountabilityAssignment(input.definitionType, input.definitionId, db)
    : null;
  const executor = input.executorProfileId
    ? getAccountabilityAssignment('agent_profile', input.executorProfileId, db)
    : null;
  return {
    resolution: input.resolution,
    definition: input.definitionType ? {
      type: input.definitionType,
      id: input.definitionId ?? null,
      key: input.definitionKey ?? null,
      version: input.definitionVersion ?? null,
      domain: definition ? { id: definition.domainId, key: definition.domainKey, name: definition.domainName } : null,
    } : null,
    executor: input.executorProfileId ? {
      profileId: input.executorProfileId,
      profileKey: input.executorProfileKey ?? null,
      profileVersion: input.executorProfileVersion ?? null,
      domain: executor ? { id: executor.domainId, key: executor.domainKey, name: executor.domainName } : null,
    } : null,
  };
}

function auditDefinitions(targetType: AccountabilityTargetType, db: Database.Database) {
  const table = targetTable(targetType);
  return db.prepare(`
    SELECT t.id, t.key, t.name, ad.key AS domain_key, ad.name AS domain_name
    FROM ${table} t
    LEFT JOIN accountability_domain_assignments ada ON ada.target_type = ? AND ada.target_id = t.id
    LEFT JOIN accountability_domains ad ON ad.id = ada.domain_id
    ORDER BY t.key
  `).all(targetType) as Array<{ id: string; key: string; name: string; domain_key: string | null; domain_name: string | null }>;
}

export function buildAccountabilityAuditReport(db: Database.Database = getDb()) {
  const profiles = auditDefinitions('agent_profile', db);
  const workflows = auditDefinitions('workflow', db);
  const tasks = auditDefinitions('task', db);
  const profileDomain = new Map(profiles.map((item) => [item.id, item.domain_key]));
  const workflowRows = db.prepare('SELECT id, key, name, version, definition_json FROM workflows ORDER BY key').all() as Array<{
    id: string; key: string; name: string; version: number; definition_json: string;
  }>;
  const workflowExecution: Array<Record<string, unknown>> = [];
  const fallbacks: Array<Record<string, unknown>> = [];
  for (const workflow of workflowRows) {
    const definition = parseRecord(workflow.definition_json);
    const steps = Array.isArray(definition.steps) ? definition.steps : [];
    for (const rawStep of steps) {
      if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) continue;
      const step = rawStep as Record<string, unknown>;
      if (step.type !== 'agent') continue;
      try {
        const executor = workflowAgentExecutor(definition, step, db);
        const workflowDomain = workflows.find((item) => item.id === workflow.id)?.domain_key ?? null;
        const executorDomain = profileDomain.get(executor.profileId) ?? null;
        const item = {
          workflowKey: workflow.key,
          workflowVersion: workflow.version,
          workflowDomain,
          stepKey: typeof step.key === 'string' ? step.key : null,
          executorProfileKey: executor.profileKey,
          executorDomain,
          resolution: executor.resolution,
          crossDomain: Boolean(workflowDomain && executorDomain && workflowDomain !== executorDomain),
        };
        workflowExecution.push(item);
        if (executor.resolution === 'admin-fallback') fallbacks.push({ definitionType: 'workflow', ...item });
      } catch (error) {
        workflowExecution.push({
          workflowKey: workflow.key,
          workflowVersion: workflow.version,
          stepKey: typeof step.key === 'string' ? step.key : null,
          error: error instanceof Error ? error.message : 'AGENT_EXECUTOR_RESOLUTION_FAILED',
        });
      }
    }
  }
  const taskRows = db.prepare('SELECT id, key, name, task_type, agent_config_json FROM tasks ORDER BY key').all() as Array<{
    id: string; key: string; name: string; task_type: string; agent_config_json: string;
  }>;
  const taskExecution = taskRows.map((task) => {
    const agentConfig = parseRecord(task.agent_config_json);
    const taskDomain = tasks.find((item) => item.id === task.id)?.domain_key ?? null;
    if (!taskUsesAgentExecutor(task.task_type, agentConfig)) {
      return {
        taskKey: task.key,
        taskDomain,
        executorProfileKey: null,
        executorDomain: null,
        resolution: 'not-applicable' as const,
        crossDomain: false,
      };
    }
    try {
      const executor = taskAgentExecutor(agentConfig, db);
      const executorDomain = profileDomain.get(executor.profileId) ?? null;
      const item = {
        taskKey: task.key, taskDomain, executorProfileKey: executor.profileKey, executorDomain,
        resolution: executor.resolution,
        crossDomain: Boolean(taskDomain && executorDomain && taskDomain !== executorDomain),
      };
      if (executor.resolution === 'admin-fallback') fallbacks.push({ definitionType: 'task', ...item });
      return item;
    } catch (error) {
      return { taskKey: task.key, error: error instanceof Error ? error.message : 'AGENT_EXECUTOR_RESOLUTION_FAILED' };
    }
  });
  const attribution = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN executor_resolution IS NULL THEN 1 ELSE 0 END) AS missing_resolution,
           SUM(CASE WHEN accountability_snapshot_json = '{}' THEN 1 ELSE 0 END) AS missing_snapshot,
           SUM(CASE WHEN executor_resolution = 'historical-unknown' THEN 1 ELSE 0 END) AS historical_unknown
    FROM (SELECT executor_resolution, accountability_snapshot_json FROM agent_runs ORDER BY created_at DESC LIMIT 250)
  `).get() as { total: number; missing_resolution: number; missing_snapshot: number; historical_unknown: number };
  return {
    generatedAt: new Date().toISOString(),
    domains: listAccountabilityDomains({ includeArchived: true }, db),
    definitions: { profiles, workflows, tasks },
    unassigned: {
      profiles: profiles.filter((item) => !item.domain_key),
      workflows: workflows.filter((item) => !item.domain_key),
      tasks: tasks.filter((item) => !item.domain_key),
    },
    execution: { workflows: workflowExecution, tasks: taskExecution, adminFallbacks: fallbacks },
    recentRunAttribution: {
      sampleSize: attribution.total ?? 0,
      missingResolution: attribution.missing_resolution ?? 0,
      missingSnapshot: attribution.missing_snapshot ?? 0,
      historicalUnknown: attribution.historical_unknown ?? 0,
    },
  };
}
