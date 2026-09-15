import type { Migration } from './index';

export const requestHumanHoursEstimateMigration: Migration = {
  name: '024_request_human_hours_estimate',
  sql: `
    ALTER TABLE change_requests ADD COLUMN estimated_human_hours REAL;
  `,
};
