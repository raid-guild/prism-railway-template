import { NextResponse } from 'next/server'
import { getAgentProfileVersion, getAgentRun, getTaskByKey, getTaskRun, listHostedSkills, listHostedSkillSourceRoots, loadConfig } from '@/lib/app-core'
import { requireTaskRunnerMutationAccess } from '@/lib/internal-service'
import { resolveTaskHandoffContext, TaskHandoffContextError } from '@/lib/task-handoff-context'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireTaskRunnerMutationAccess()
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  const { id } = await context.params
  const expectedTaskUpdatedAt = new URL(request.url).searchParams.get('expectedTaskUpdatedAt') ?? ''
  try {
    const taskRun = getTaskRun(id)
    const task = taskRun?.taskKey ? getTaskByKey(taskRun.taskKey) : null
    const agentRun = taskRun?.agentRunId ? getAgentRun(taskRun.agentRunId) : null
    const profile = agentRun?.agentProfileId ? getAgentProfileVersion(agentRun.agentProfileId, agentRun.agentProfileVersion) : null
    const config = loadConfig()
    const handoffContext = resolveTaskHandoffContext({
      taskRun, task, agentRun, profile, expectedTaskUpdatedAt,
      hostedSkills: listHostedSkills(config.repoRoot, config.customSkillsRoot, listHostedSkillSourceRoots()),
    })
    return NextResponse.json({ ok: true, handoffContext })
  } catch (error) {
    const code = error instanceof TaskHandoffContextError ? error.code : 'UNAVAILABLE'
    return NextResponse.json({ ok: false, error: `TASK_HANDOFF_CONTEXT_${code}` }, { status: 409 })
  }
}
