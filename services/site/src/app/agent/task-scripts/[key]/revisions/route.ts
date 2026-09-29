import { NextResponse } from 'next/server';
import { createScriptRevision, getTaskScriptByKey, listScriptRevisions, readTaskScriptFile, checksumScriptSource } from '@/lib/app-core';
import { requireServiceAccess } from '@/lib/internal-service';

type Context = { params: Promise<{ key: string }> };
export async function GET(_request: Request, context: Context) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const { key } = await context.params;
  return NextResponse.json({ ok: true, revisions: listScriptRevisions(decodeURIComponent(key)).map(({ source: _source, ...revision }) => revision) });
}
export async function POST(request: Request, context: Context) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const { key } = await context.params;
  const script = getTaskScriptByKey(decodeURIComponent(key));
  if (!script) return NextResponse.json({ ok: false, error: 'TASK_SCRIPT_NOT_FOUND' }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const binding = typeof body?.inputBinding === 'string' ? body.inputBinding.trim() : '';
  const createdBy = typeof body?.createdBy === 'string' ? body.createdBy.trim() : '';
  if (!new Set(['request-snapshot-v1', 'workflow-health-snapshot-v1']).has(binding) || !createdBy) {
    return NextResponse.json({ ok: false, error: 'SCRIPT_REVISION_INPUT_INVALID' }, { status: 400 });
  }
  const source = await readTaskScriptFile(script);
  if (checksumScriptSource(source) !== script.checksum || script.runtime !== 'node-esm') {
    return NextResponse.json({ ok: false, error: 'TASK_SCRIPT_SOURCE_MISMATCH' }, { status: 409 });
  }
  const revision = createScriptRevision({ scriptKey: script.key, source, runtime: 'node-esm', inputBinding: binding,
    timeoutMs: Math.min(30_000, script.timeoutMs ?? 30_000), outputMaxBytes: 262_144, createdBy });
  const { source: _source, ...metadata } = revision;
  return NextResponse.json({ ok: true, revision: metadata }, { status: 201 });
}
