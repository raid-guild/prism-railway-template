import { mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Store terminal response envelopes only: never job inputs or credential leases. */
export class JobReceipts {
  constructor(private directory: string) {}
  private file(id: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('INVALID_JOB_ID');
    return path.join(this.directory, `${id}.json`);
  }
  save(job: { id: string; status: string; [key: string]: unknown }) {
    if (!['succeeded', 'failed', 'canceled'].includes(job.status)) throw new Error('NON_TERMINAL_RECEIPT');
    // An explicit allowlist prevents callers from accidentally persisting prompts or leases.
    const { id, status, result, error, trace, createdAt, startedAt, finishedAt, contractVersion } = job;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = this.file(id);
    writeFileSync(`${file}.tmp`, JSON.stringify({ id, status, result, error, trace, createdAt, startedAt, finishedAt, contractVersion }), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }
  read(id: string): Record<string, unknown> | null {
    try {
      const value = JSON.parse(readFileSync(this.file(id), 'utf8'));
      return value.id === id && ['succeeded', 'failed', 'canceled'].includes(value.status) ? value : null;
    } catch { return null; }
  }
}
