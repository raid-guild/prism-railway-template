import type { Migration } from './index';

export const workflowEventSequenceMigration: Migration = {
  name: '033_workflow_event_sequence',
  sql: `
    ALTER TABLE workflow_events ADD COLUMN event_sequence INTEGER;

    CREATE TABLE workflow_event_sequence_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0)
    );

    INSERT INTO workflow_event_sequence_state (id, last_sequence) VALUES (1, 0);

    WITH ordered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS sequence
      FROM workflow_events
    )
    UPDATE workflow_events
    SET event_sequence = (
      SELECT ordered.sequence FROM ordered WHERE ordered.id = workflow_events.id
    );

    UPDATE workflow_event_sequence_state
    SET last_sequence = COALESCE((SELECT MAX(event_sequence) FROM workflow_events), 0)
    WHERE id = 1;

    CREATE TRIGGER workflow_events_assign_sequence
    AFTER INSERT ON workflow_events
    FOR EACH ROW
    WHEN NEW.event_sequence IS NULL
    BEGIN
      UPDATE workflow_event_sequence_state
      SET last_sequence = last_sequence + 1
      WHERE id = 1;

      UPDATE workflow_events
      SET event_sequence = (
        SELECT last_sequence FROM workflow_event_sequence_state WHERE id = 1
      )
      WHERE id = NEW.id;
    END;

    CREATE UNIQUE INDEX idx_workflow_events_sequence
      ON workflow_events(event_sequence);

    CREATE INDEX idx_workflow_events_type_sequence
      ON workflow_events(event_type, event_sequence);
  `,
};
