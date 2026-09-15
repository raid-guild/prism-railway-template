import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('createAgentRun persists an explicit immutable executor snapshot', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'prism-agent-executor-'));
  process.env.PRISM_AGENT_DATA_ROOT = dataRoot;
  const core = await import('./index');
  try {
    core.runMigrations();
    const admin = core.getAgentProfile('admin-agent');
    assert.ok(admin);
    const builtinAssignment = core.getAccountabilityAssignment('agent_profile', admin.id);
    assert.equal(builtinAssignment?.domainKey, 'prism-builtins');
    const run = core.createAgentRun({
      kind: 'workflow_step',
      status: 'queued',
      requestId: null,
      agentProfileId: admin.id,
      agentProfileVersion: admin.version,
      executionMode: 'orchestrator',
      executorResolution: 'step-explicit',
      accountabilitySnapshot: core.buildAccountabilitySnapshot({
        executorProfileId: admin.id,
        executorProfileKey: admin.key,
        executorProfileVersion: admin.version,
        resolution: 'step-explicit',
      }),
      input: { prompt: 'bounded test' },
    });
    assert.equal(run?.agentProfileId, admin.id);
    assert.equal(run?.agentProfileVersion, admin.version);
    assert.equal(run?.executionMode, 'orchestrator');
    assert.equal(run?.executorResolution, 'step-explicit');
    assert.equal(
      (run?.accountabilitySnapshot.executor as { domain?: { key?: string } } | undefined)?.domain?.key,
      'prism-builtins',
    );

    const domain = core.upsertAccountabilityDomain({
      key: 'delivery',
      name: 'Delivery',
      description: 'Owns delivery automation.',
    });
    assert.equal(domain.version, 1);
    const workflow = core.upsertWorkflow({
      key: 'delivery-check',
      name: 'Delivery Check',
      definition: { key: 'delivery-check', entrypoint: 'inspect', steps: [{ key: 'inspect', type: 'agent' }] },
      systemDefault: false,
    });
    core.assignAccountabilityDomain({ targetType: 'workflow', targetKey: workflow.key, domainKey: domain.key });
    const audit = core.buildAccountabilityAuditReport();
    assert.equal(audit.execution.workflows.find((item) => item.workflowKey === workflow.key)?.resolution, 'admin-fallback');
    assert.ok(audit.execution.adminFallbacks.some((item) => item.definitionType === 'workflow' && item.workflowKey === workflow.key));

    const deterministicTask = core.upsertTask({
      key: 'deterministic-sync',
      name: 'Deterministic Sync',
      taskType: 'http-post',
      enabled: true,
    });
    const taskRun = core.createTaskRun({
      taskKey: deterministicTask.key,
      status: 'succeeded',
      triggerSource: 'manual',
    });
    const deterministicAgentRun = taskRun.agentRunId ? core.getAgentRun(taskRun.agentRunId) : null;
    assert.equal(deterministicAgentRun?.executorResolution, 'not-applicable');
    assert.equal(deterministicAgentRun?.agentProfileId, null);
    const taskAudit = core.buildAccountabilityAuditReport();
    assert.equal(
      taskAudit.execution.tasks.find((item) => item.taskKey === deterministicTask.key)?.resolution,
      'not-applicable',
    );
    assert.equal(
      taskAudit.execution.adminFallbacks.some(
        (item) => item.definitionType === 'task' && item.taskKey === deterministicTask.key,
      ),
      false,
    );
  } finally {
    core.closeDb();
    rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.PRISM_AGENT_DATA_ROOT;
  }
});
