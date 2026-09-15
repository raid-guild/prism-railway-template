import assert from 'node:assert/strict';
import test from 'node:test';
import { doctorRepairWorkflowKey, matchingDoctorRepairRequest } from './prism-doctor-repair.js';

test('Doctor defaults to maintenance while preserving explicit instance overrides', () => {
  assert.equal(doctorRepairWorkflowKey(''), 'prism-maintenance');
  assert.equal(doctorRepairWorkflowKey('   '), 'prism-maintenance');
  assert.equal(doctorRepairWorkflowKey(' custom-repair '), 'custom-repair');
});
test('Doctor reuses only a request on the configured repair workflow', () => {
  const legacy = { id: 'old', title: 'Repair', workflowKey: 'change-request-default' };
  const maintenance = { id: 'new', title: 'Repair', workflowKey: 'prism-maintenance' };
  assert.equal(matchingDoctorRepairRequest([legacy], 'Repair', 'prism-maintenance'), null);
  assert.equal(matchingDoctorRepairRequest([legacy, maintenance], 'Repair', 'prism-maintenance'), maintenance);
});
