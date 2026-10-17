import assert from 'node:assert/strict';

import { test } from 'vitest';

import { autoSpeakText, setLiveVoiceActive } from '@/modules/chat/utils/autoSpeak';
import type { NormalizedMessage } from '@/shared/types';

/**
 * autoSpeakText decides what a finished turn says out loud. It has to pick the final answer,
 * not the narration before tool calls, and in 'voice' mode it must stay quiet for typed messages,
 * or every reply in every chat would start talking.
 */

let n = 0;
const row = (kind: NormalizedMessage['kind'], role: 'user' | 'assistant' | undefined, content: string) =>
  ({ id: `m${n++}`, sessionId: 's', timestamp: '', provider: 'claude', kind, role, content }) as NormalizedMessage;

const turn = (userText: string) => [
  row('text', 'user', 'earlier question'),
  row('text', 'assistant', 'earlier answer'),
  row('text', 'user', userText),
  row('text', 'assistant', 'Let me check your calendar.'),
  row('tool_use', undefined, ''),
  row('tool_result', undefined, 'raw tool output'),
  row('text', 'assistant', 'You have two classes today.'),
];

test('speaks the final assistant text of the turn, not the narration before tools', () => {
  assert.equal(autoSpeakText(turn('[voice] what is on today'), 'voice'), 'You have two classes today.');
});

test("voice mode stays quiet when the user's message was typed", () => {
  assert.equal(autoSpeakText(turn('what is on today'), 'voice'), null);
});

test('always mode speaks typed turns too', () => {
  assert.equal(autoSpeakText(turn('what is on today'), 'always'), 'You have two classes today.');
});

test('off, unknown modes and empty settings speak nothing', () => {
  for (const mode of ['off', '', 'loud']) {
    assert.equal(autoSpeakText(turn('[voice] hi'), mode), null);
  }
});

test('a turn with no reply text yet speaks nothing', () => {
  const messages = [row('text', 'user', '[voice] hi'), row('tool_use', undefined, '')];
  assert.equal(autoSpeakText(messages, 'voice'), null);
});

test('leading whitespace before the marker still counts as spoken', () => {
  const messages = [row('text', 'user', '  [voice] hi'), row('text', 'assistant', 'Hello.')];
  assert.equal(autoSpeakText(messages, 'voice'), 'Hello.');
});

test('stays quiet while a live voice session runs, then speaks again once it ends', () => {
  const messages = turn('[voice] what is on today');
  setLiveVoiceActive(true);
  assert.equal(autoSpeakText(messages, 'voice'), null);
  assert.equal(autoSpeakText(messages, 'always'), null);
  setLiveVoiceActive(false);
  assert.equal(autoSpeakText(messages, 'voice'), 'You have two classes today.');
});
