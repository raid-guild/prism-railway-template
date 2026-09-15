import type { Migration } from './index';

export const activeAgentExecutorFallbackMigration: Migration = {
  name: '043_active_agent_executor_fallback',
  sql: `
    UPDATE agent_runs
    SET agent_profile_id = 'agent-profile-admin',
        agent_profile_version = (
          SELECT version FROM agent_profiles WHERE id = 'agent-profile-admin'
        ),
        execution_mode = COALESCE(execution_mode, 'worker')
    WHERE agent_profile_id IS NULL
      AND status IN ('queued', 'claimed', 'running');
  `,
};
