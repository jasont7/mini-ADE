import assert from 'node:assert/strict';

import { test } from 'vitest';

import { toSpeakableText } from '@/modules/chat/utils/speakableText';

test('drops code blocks, urls and markdown symbols', () => {
  const text = '## Done\n\nI fixed **the bug** in `main.ts`. See [the PR](https://x.io/pr/1) or https://x.io/raw.\n\n```ts\nconst a = 1;\n```';
  assert.equal(toSpeakableText(text), 'Done I fixed the bug in main.ts. See the PR or');
});

test('keeps at most four sentences', () => {
  assert.equal(toSpeakableText('One. Two. Three. Four. Five. Six.'), 'One. Two. Three. Four.');
});

test('cuts overly long output at a sentence end', () => {
  const long = `${'word '.repeat(60).trim()}. ${'more '.repeat(60).trim()}.`;
  const spoken = toSpeakableText(long, 400);
  assert.ok(spoken.length <= 400);
  assert.ok(spoken.endsWith('.'));
});

test('returns an empty string for code only replies', () => {
  assert.equal(toSpeakableText('```sh\nls\n```'), '');
});
