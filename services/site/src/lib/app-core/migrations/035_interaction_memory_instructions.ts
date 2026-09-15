import type { Migration } from './index';

export const interactionMemoryInstructionsMigration: Migration = {
  name: '035_interaction_memory_instructions',
  sql: `
    ALTER TABLE interaction_profiles ADD COLUMN memory_source_ids_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE interaction_profiles ADD COLUMN memory_buckets_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE interaction_profiles ADD COLUMN memory_instructions TEXT NOT NULL DEFAULT '';
  `,
};
