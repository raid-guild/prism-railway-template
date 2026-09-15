/** Activity extends the idle deadline, never the absolute execution budget. */
export class RunBudget {
  private lastProgress: number;
  constructor(readonly startedAt: number, readonly idleMs: number, readonly maxMs: number) {
    this.lastProgress = startedAt;
  }
  progress(now: number) { this.lastProgress = Math.max(this.lastProgress, now); }
  expired(now: number): 'budget' | 'idle' | null {
    if (now - this.startedAt >= this.maxMs) return 'budget';
    if (now - this.lastProgress >= this.idleMs) return 'idle';
    return null;
  }
}

export function isExecutionProgress(event: { type?: string; item?: { type?: string } }) {
  return ['thread.started', 'turn.completed'].includes(event.type ?? '')
    || (['item.started', 'item.completed', 'item.updated'].includes(event.type ?? '')
      && ['command_execution', 'file_change', 'agent_message', 'collab_tool_call'].includes(event.item?.type ?? ''));
}

export function resolveRunBudget(value: unknown, defaults: { idleMs: number; maxMs: number }) {
  const requested = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const bounded = (value: unknown, fallback: number) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, fallback) : fallback;
  const maxMs = bounded(requested.maxDurationMs, defaults.maxMs);
  return { maxMs, idleMs: Math.min(bounded(requested.idleTimeoutMs, defaults.idleMs), maxMs) };
}
