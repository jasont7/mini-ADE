import assert from 'node:assert/strict';

import { test } from 'vitest';

import { stripVoicePrefix } from '@/modules/chat/utils/voiceBridge';

test('stripVoicePrefix removes the tag the speech server adds', () => {
  assert.equal(stripVoicePrefix('[voice] Hello there.'), 'Hello there.');
  assert.equal(stripVoicePrefix('  [Voice]   hi '), 'hi');
  assert.equal(stripVoicePrefix('no tag'), 'no tag');
});
