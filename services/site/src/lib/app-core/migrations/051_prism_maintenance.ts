import type { Migration } from './index';

export const prismMaintenanceWorkflow = {
  key: 'prism-maintenance', name: 'Prism Maintenance', version: 1,
  description: 'Tracked instance configuration repair; repository changes require a separate scoped handoff.',
  entrypoint: 'assess', workflowPath: 'workflows/prism-maintenance/workflow.md',
  target: { required: false }, defaultAgent: 'admin-agent',
  agentConfig: { contextPolicy: { continuation: 'step', handoff: 'artifacts' }, delegation: { allowed: false, maxAgents: 0 } },
  steps: [
    { key: 'assess', label: 'Assess maintenance findings', type: 'agent', next: 'repair', instructionPath: 'workflows/prism-maintenance/steps/assess.md', agentConfig: { skills: ['prism-doctor'], modelTier: 'standard' } },
    { key: 'repair', label: 'Repair instance configuration', type: 'agent', next: 'verify', instructionPath: 'workflows/prism-maintenance/steps/repair.md', agentConfig: { skills: ['prism-workflow-author', 'prism-skill-author', 'prism-gateway-author'], modelTier: 'standard' } },
    { key: 'verify', label: 'Verify maintenance results', type: 'agent', next: 'closed', instructionPath: 'workflows/prism-maintenance/steps/verify.md', agentConfig: { skills: ['prism-doctor'], modelTier: 'standard' } },
    { key: 'closed', label: 'Closed', type: 'terminal' },
  ],
};

export const prismMaintenanceMigration: Migration = {
  name: '051_prism_maintenance',
  sql: `
    INSERT OR IGNORE INTO workflows (id,key,name,description,version,definition_json,system_default,enabled,created_at,updated_at)
    VALUES ('workflow-prism-maintenance','prism-maintenance','Prism Maintenance',
      'Tracked instance configuration repair',1,'${JSON.stringify(prismMaintenanceWorkflow).replace(/'/g, "''")}',1,1,
      strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    INSERT OR IGNORE INTO accountability_domain_assignments (target_type,target_id,domain_id,created_at,updated_at)
    SELECT 'workflow',id,'accountability-domain-prism-builtins',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM workflows WHERE key='prism-maintenance';
  `,
};
