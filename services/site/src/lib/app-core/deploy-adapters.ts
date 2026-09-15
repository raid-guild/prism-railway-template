import type { ChangeRequestRecord, TargetAppRecord, TargetEnvironmentRecord } from './repository';

export interface TargetEnvironmentDeployPlan {
  mode: 'manual';
  deployBackend: string;
  targetApp: Pick<TargetAppRecord, 'id' | 'slug' | 'name' | 'defaultBranch' | 'repoUrl' | 'repoProvider'>;
  targetEnvironment: Pick<
    TargetEnvironmentRecord,
    'id' | 'slug' | 'name' | 'kind' | 'branch' | 'baseUrl' | 'deployBackend' | 'deployConfig' | 'agentWritable'
  >;
  request: Pick<ChangeRequestRecord, 'id' | 'requestNumber' | 'title' | 'targetEnvironmentId'>;
  allowed: boolean;
  warnings: string[];
  nextAction: string;
}

export function buildTargetEnvironmentDeployPlan(input: {
  request: ChangeRequestRecord;
  targetApp: TargetAppRecord;
  targetEnvironment: TargetEnvironmentRecord;
}): TargetEnvironmentDeployPlan {
  const { request, targetApp, targetEnvironment } = input;
  const warnings: string[] = [];

  if (!targetEnvironment.agentWritable) {
    warnings.push('Target environment is not agent writable.');
  }

  if (targetEnvironment.kind === 'production') {
    warnings.push('Production targets should not be redeployed by agent workflow.');
  }

  if (!targetEnvironment.deployConfig || Object.keys(targetEnvironment.deployConfig).length === 0) {
    warnings.push('Target environment deployConfig is empty.');
  }

  if (targetEnvironment.deployBackend === 'railway') {
    const deployConfig = targetEnvironment.deployConfig;
    if (typeof deployConfig.serviceName !== 'string' || !deployConfig.serviceName.trim()) {
      warnings.push('Railway deployConfig.serviceName is missing.');
    }
    if (typeof deployConfig.projectId !== 'string' || !deployConfig.projectId.trim()) {
      warnings.push('Railway deployConfig.projectId is not set. Add it before automating redeploys.');
    }
  } else if (targetEnvironment.deployBackend === 'local') {
    const deployConfig = targetEnvironment.deployConfig;
    if (typeof deployConfig.path !== 'string' || !deployConfig.path.trim()) {
      warnings.push('Local deployConfig.path is missing.');
    }
  } else {
    warnings.push(`Unsupported deploy backend for automated planning: ${targetEnvironment.deployBackend}`);
  }

  return {
    mode: 'manual',
    deployBackend: targetEnvironment.deployBackend,
    targetApp: {
      id: targetApp.id,
      slug: targetApp.slug,
      name: targetApp.name,
      defaultBranch: targetApp.defaultBranch,
      repoUrl: targetApp.repoUrl,
      repoProvider: targetApp.repoProvider,
    },
    targetEnvironment: {
      id: targetEnvironment.id,
      slug: targetEnvironment.slug,
      name: targetEnvironment.name,
      kind: targetEnvironment.kind,
      branch: targetEnvironment.branch,
      baseUrl: targetEnvironment.baseUrl,
      deployBackend: targetEnvironment.deployBackend,
      deployConfig: targetEnvironment.deployConfig,
      agentWritable: targetEnvironment.agentWritable,
    },
    request: {
      id: request.id,
      requestNumber: request.requestNumber,
      title: request.title,
      targetEnvironmentId: request.targetEnvironmentId,
    },
    allowed: warnings.length === 0,
    warnings,
    nextAction:
      warnings.length === 0
        ? targetEnvironment.deployBackend === 'local'
          ? 'Run the target locally from the configured workspace and report the local URL in the agent-run result and request artifacts when useful.'
          : 'Publish or update the review branch and report the PR preview URL in the agent-run result and request artifacts when useful.'
        : 'Resolve the warnings before using this target for agent-run work.',
  };
}
