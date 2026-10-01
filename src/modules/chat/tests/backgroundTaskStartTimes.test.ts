import assert from 'node:assert/strict';

import { test } from 'vitest';

import { findBackgroundTaskStartTimes } from '@/modules/chat/utils/backgroundTaskStartTimes';
import type { ChatMessage } from '@/shared/types';

// The background tab's timer counts from the tool call that launched the task,
// so it survives a reload instead of restarting at zero.

const toolMessage = (timestamp: string, result: string): ChatMessage => ({
  type: 'assistant',
  content: '',
  timestamp,
  isToolUse: true,
  toolName: 'Bash',
  toolResult: { content: result },
} as ChatMessage);

test('a task is timed from the tool call whose result names it', () => {
  const messages = [
    toolMessage('2026-09-29T23:00:00.000Z', 'ok'),
    // A command that outlived its 600 s timeout: the result lands ten minutes
    // later, but the message keeps the call's own timestamp.
    toolMessage('2026-09-29T23:12:54.000Z', 'Command did not complete within its 600s timeout and was moved to the background (ID: bd8mlw6ad).'),
    toolMessage('2026-09-29T23:20:00.000Z', 'Monitor started (task bbln0zsfy, expires in 30m)'),
  ];

  const startTimes = findBackgroundTaskStartTimes(messages, [
    { id: 'bd8mlw6ad', description: 'Compare v1 and v2' },
    { id: 'bbln0zsfy', description: 'Narval Makefile' },
  ]);

  assert.equal(startTimes.get('bd8mlw6ad'), Date.parse('2026-09-29T23:12:54.000Z'));
  assert.equal(startTimes.get('bbln0zsfy'), Date.parse('2026-09-29T23:20:00.000Z'));
});

test('a task the transcript never mentions is left out', () => {
  const startTimes = findBackgroundTaskStartTimes(
    [toolMessage('2026-09-29T23:00:00.000Z', 'Command running in background with ID: other1')],
    [{ id: 'subagent-launched', description: '' }],
  );
  assert.equal(startTimes.size, 0);
});
