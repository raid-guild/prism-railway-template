import type { Migration } from './index';

export const restoreRecordingSystemDefaultMigration: Migration = {
  name: '037_restore_recording_system_default',
  sql: `
    UPDATE workflows
       SET system_default = 1,
           updated_at = datetime('now')
     WHERE key = 'recording-transcript-review-publish'
       AND version = 4
       AND system_default = 0
       AND json_valid(definition_json) = 1
       AND json_extract(definition_json, '$.hookProcessing') = 'deterministic-recording-v1'
       AND json_extract(definition_json, '$.entrypoint') = 'closed'
       AND json_array_length(json_extract(definition_json, '$.steps')) = 1
       AND json_extract(definition_json, '$.steps[0].key') = 'closed'
       AND json_extract(definition_json, '$.steps[0].type') = 'terminal';
  `,
};
