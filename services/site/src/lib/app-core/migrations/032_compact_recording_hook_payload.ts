import type { Migration } from './index';

export const compactRecordingHookPayloadMigration: Migration = {
  name: '032_compact_recording_hook_payload',
  sql: `
    UPDATE hooks
       SET request_template_json = replace(
             request_template_json,
             '\\n\\nPayload:\\n{{payload}}',
             ''
           ),
           updated_at = datetime('now')
     WHERE key = 'recording-transcript-completed'
       AND request_template_json LIKE '%Payload:%{{payload}}%';
  `,
};
