import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOpenWorkflowRequests } from './workflow-single-flight.js';
test('single flight groups both maintenance intakes and fails closed on incomplete inventory', () => {
  assert.deepEqual(findOpenWorkflowRequests({ changeRequests: [{ workflowKey: 'prism-maintenance', requestNumber: 2327 }, { workflowKey: 'other' }] }, ['prism-maintenance', 'workflow-repair-loop']).map(r => r.requestNumber), [2327]);
  assert.throws(() => findOpenWorkflowRequests(null, []), /INCOMPLETE/);
  assert.throws(() => findOpenWorkflowRequests({ changeRequests: Array(500).fill({}) }, []), /INCOMPLETE/);
});
