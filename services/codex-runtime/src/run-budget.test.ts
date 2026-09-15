import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunBudget, isExecutionProgress, resolveRunBudget } from './run-budget.js';

test('activity extends idle but never hard budget', () => {
  const budget = new RunBudget(0, 20, 60);
  budget.progress(19);
  assert.equal(budget.expired(21), null);
  assert.equal(budget.expired(39), 'idle');
  budget.progress(59);
  assert.equal(budget.expired(60), 'budget');
});
test('noise and polls are not execution progress', () => {
  for (const type of ['stderr', 'heartbeat', 'error']) assert.equal(isExecutionProgress({ type }), false);
  assert.equal(isExecutionProgress({ type: 'item.completed', item: { type: 'command_execution' } }), true);
});
test('step budgets may narrow but never widen instance limits', () => {
  const defaults = { idleMs: 20, maxMs: 60 };
  assert.deepEqual(resolveRunBudget({ idleTimeoutMs: 10, maxDurationMs: 30 }, defaults), { idleMs: 10, maxMs: 30 });
  assert.deepEqual(resolveRunBudget({ idleTimeoutMs: -1, maxDurationMs: Infinity }, defaults), defaults);
  assert.deepEqual(resolveRunBudget({ idleTimeoutMs: 99, maxDurationMs: 99 }, defaults), defaults);
});
