import type { Migration } from './index';

export const dreamerSnapshot = {
  key: 'dreamer-agent', name: 'Dreamer', status: 'active', systemKey: 'dreamer-agent',
  description: 'Bounded maintenance owner for configuration drift, safe request recovery, and evidence-backed improvement proposals.',
  owner: { type: 'workspace', userId: null, agentProfileId: null },
  persona: { name: 'Dreamer', instructions: 'Own the consolidated Prism maintenance workflow. Repair only when intended state, current broken state, exact scoped mutation, verification path, and durable receipt are established. Scheduled dispatch authorizes bounded internal repairs, not broad redesign. Preserve human approvals and business policy. Never replay ambiguous external side effects, alter credentials or access policy, publish, spend funds, deploy, merge, or delete data without separate explicit authority. Memory work is read-only diagnosis and recommendations: do not rewrite, delete, reclassify, rebuild, or promote memory. Propose broader improvements with evidence, benefit and rollback. Use provider-neutral model presets and step-local skills. Never change your own authority, owner, bindings, or schedule. Independent safe repairs proceed while blocked items remain documented. Verify before closure.' },
  runtimeProfileKey: null, modelTier: 'standard', skills: [],
  memoryScope: { scope: 'maintenance-evidence', instructions: 'Read only relevant evidence. Memory modifications require separate operator approval.', enforcement: 'instructions-only' },
  authority: { mode: 'policy-controlled', maximumAccessMode: 'full', consoleAccessMode: 'full', credentialPolicy: 'none', allowedMutations: ['prism.configuration_repair', 'prism.request_recovery', 'prism.request_artifact'], forbiddenMutations: ['memory.write', 'memory.delete', 'credentials.write', 'access_policy.write', 'production.deploy', 'github.merge', 'public.publish', 'funds.spend'] },
  contextPolicy: { continuation: 'step', handoff: 'artifacts' }, version: 1,
};
const json = (value: unknown) => JSON.stringify(value).replace(/'/g, "''");
export const dreamerAgentMigration: Migration = {
  name: '052_dreamer_agent',
  sql: `
    INSERT OR IGNORE INTO agent_profiles
    (id,key,name,description,status,system_key,owner_type,persona_json,skills_json,memory_scope_json,authority_json,context_policy_json,model_tier,version,created_at,updated_at)
    VALUES ('agent-profile-dreamer','dreamer-agent','Dreamer','${dreamerSnapshot.description}', 'active','dreamer-agent','workspace',
    '${json(dreamerSnapshot.persona)}','[]','${json(dreamerSnapshot.memoryScope)}','${json(dreamerSnapshot.authority)}','${json(dreamerSnapshot.contextPolicy)}','standard',1,datetime('now'),datetime('now'));
    INSERT OR IGNORE INTO agent_profile_versions(profile_id,version,snapshot_json,created_at)
    SELECT id,1,'${json(dreamerSnapshot)}',datetime('now') FROM agent_profiles WHERE id='agent-profile-dreamer' AND version=1;
    INSERT OR IGNORE INTO accountability_domain_assignments(target_type,target_id,domain_id,created_at,updated_at)
    SELECT 'agent_profile','agent-profile-dreamer','accountability-domain-prism-builtins',datetime('now'),datetime('now')
    WHERE EXISTS (SELECT 1 FROM agent_profiles WHERE id='agent-profile-dreamer');
    UPDATE workflows SET definition_json=json_set(definition_json,'$.defaultAgent','dreamer-agent'),updated_at=datetime('now')
    WHERE key='prism-maintenance' AND system_default=1 AND json_extract(definition_json,'$.defaultAgent')='admin-agent';
  `,
};
