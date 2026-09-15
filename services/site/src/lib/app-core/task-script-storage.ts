import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config';
import { type TaskScriptRecord } from './repository';

const taskScriptRootName = 'task-scripts';

function sanitizeScriptKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function taskScriptsRoot() {
  return path.resolve(loadConfig().dataRoot, taskScriptRootName);
}

export function buildTaskScriptStoragePath(input: { key: string; checksum: string }) {
  const key = sanitizeScriptKey(input.key);
  const digest = input.checksum.replace(/^sha256:/, '').replace(/[^a-fA-F0-9]/g, '').slice(0, 16) || 'current';
  return path.join(key, `${digest}.mjs`);
}

export function resolveTaskScriptStoragePath(storagePath: string) {
  const root = taskScriptsRoot();
  const resolved = path.resolve(root, storagePath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('TASK_SCRIPT_PATH_OUTSIDE_ROOT');
  }

  return resolved;
}

export async function writeTaskScriptFile(storagePath: string, content: string) {
  const resolved = resolveTaskScriptStoragePath(storagePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content.trimEnd() + '\n', 'utf8');
}

export async function readTaskScriptFile(script: TaskScriptRecord) {
  return fs.readFile(resolveTaskScriptStoragePath(script.storagePath), 'utf8');
}

export async function deleteTaskScriptFile(storagePath: string) {
  await fs.rm(resolveTaskScriptStoragePath(storagePath), { force: true });
}
