import assert from 'node:assert/strict';
import test from 'node:test';

import { detectAgentAvatarMimeType, validateAgentAvatar } from './agent-avatar-storage';

test('Agent avatar validation accepts supported image signatures', () => {
  assert.equal(detectAgentAvatarMimeType(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
  assert.equal(detectAgentAvatarMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(detectAgentAvatarMimeType(Buffer.from('GIF89a', 'ascii')), 'image/gif');
  assert.equal(detectAgentAvatarMimeType(Buffer.from('RIFF0000WEBP', 'ascii')), 'image/webp');
})

test('Agent avatar validation rejects empty, disguised, and oversized files', () => {
  assert.throws(() => validateAgentAvatar(new Uint8Array()), /AGENT_AVATAR_EMPTY/);
  assert.throws(() => validateAgentAvatar(Buffer.from('<script>alert(1)</script>')), /AGENT_AVATAR_FORMAT_UNSUPPORTED/);
  assert.throws(() => validateAgentAvatar(new Uint8Array(5 * 1024 * 1024 + 1)), /AGENT_AVATAR_TOO_LARGE/);
})
