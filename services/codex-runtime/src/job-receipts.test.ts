import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobReceipts } from './job-receipts.js';

test('terminal result survives a new store instance without input credentials', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'prism-receipts-'));
  try {
    const id = '88c48edd-655a-4415-9468-2d8d2aec8953';
    new JobReceipts(directory).save({ id, status: 'succeeded', result: { responseText: 'Done' }, input: { credentials: ['secret'] } });
    const recovered = new JobReceipts(directory).read(id);
    assert.deepEqual(recovered?.result, { responseText: 'Done' });
    assert.equal(recovered?.input, undefined);
    assert.equal(new JobReceipts(directory).read('../../etc/passwd'), null);
    assert.throws(() => new JobReceipts(directory).save({ id, status: 'running' }), /NON_TERMINAL/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
