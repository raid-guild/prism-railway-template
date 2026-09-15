import fs from 'node:fs';
import path from 'node:path';

import { loadConfig } from './config';

const maxAgentAvatarBytes = 5 * 1024 * 1024;

export type AgentAvatarMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export function detectAgentAvatarMimeType(bytes: Uint8Array): AgentAvatarMimeType | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(Buffer.from(bytes.subarray(0, 6)).toString('ascii'))) return 'image/gif';
  return null;
}

function avatarRoot() {
  return path.resolve(loadConfig().dataRoot, 'agent-avatars');
}

function avatarPath(profileId: string) {
  if (!/^[a-zA-Z0-9-]{1,200}$/.test(profileId)) throw new Error('AGENT_PROFILE_ID_INVALID');
  return path.resolve(avatarRoot(), `${profileId}.image`);
}

export function validateAgentAvatar(bytes: Uint8Array) {
  if (!bytes.length) throw new Error('AGENT_AVATAR_EMPTY');
  if (bytes.length > maxAgentAvatarBytes) throw new Error('AGENT_AVATAR_TOO_LARGE');
  const mimeType = detectAgentAvatarMimeType(bytes);
  if (!mimeType) throw new Error('AGENT_AVATAR_FORMAT_UNSUPPORTED');
  return mimeType;
}

export function writeAgentAvatar(profileId: string, bytes: Uint8Array) {
  const mimeType = validateAgentAvatar(bytes);
  const root = avatarRoot();
  const destination = avatarPath(profileId);
  fs.mkdirSync(root, { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, destination);
  return { mimeType, size: bytes.length };
}

export function readAgentAvatar(profileId: string) {
  const bytes = fs.readFileSync(avatarPath(profileId));
  return { bytes, mimeType: validateAgentAvatar(bytes) };
}
