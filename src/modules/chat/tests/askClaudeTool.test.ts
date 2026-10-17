import assert from 'node:assert/strict';

import { test } from 'vitest';

import { runToolCalls } from '@/modules/chat/utils/askClaudeTool';
import type { ToolCallResult } from '@/modules/chat/utils/askClaudeTool';

function harness(options: { reply?: () => Promise<string>; nonBlocking?: boolean; cancelled?: string[] } = {}) {
  const results: ToolCallResult[] = [];
  const asked: string[] = [];
  const busy: boolean[] = [];
  const notes: string[] = [];
  const deps = {
    nonBlockingTools: options.nonBlocking ?? false,
    askClaude: async (request: string) => {
      asked.push(request);
      return options.reply ? options.reply() : '**Done.** I listed 3 files, see https://x.io.';
    },
    respond: (result: ToolCallResult) => results.push(result),
    isCancelled: (id: string) => (options.cancelled ?? []).includes(id),
    onBusyChange: (value: boolean) => busy.push(value),
    onNote: (text: string) => notes.push(text),
  };
  return { deps, results, asked, busy, notes };
}

test('ask_claude sends the request and returns a speakable reply', async () => {
  const { deps, results, asked, busy } = harness();
  await runToolCalls([{ id: 'c1', name: 'ask_claude', args: { request: ' list files ' } }], deps);
  assert.deepEqual(asked, ['list files']);
  assert.equal(results[0].output, 'Done. I listed 3 files, see');
  assert.equal(results[0].scheduling, null);
  assert.deepEqual(busy, [true, false]);
});

test('the request and the reply become one-line notes for the saved transcript', async () => {
  const { deps, notes } = harness({ reply: async () => 'Three files.' });
  await runToolCalls([{ id: 'c1', name: 'ask_claude', args: { request: 'list\nfiles' } }], deps);
  assert.deepEqual(notes, ['Asked Claude: list files', 'Claude replied: Three files.']);
});

test('a refusal becomes a sentence for the model and a note, and the busy count still comes back', async () => {
  const { deps, results, busy, notes } = harness({ reply: async () => { throw new Error("'Bikes' is busy working on something."); } });
  await runToolCalls([{ id: 'c1', name: 'ask_claude', args: { request: 'go' } }], deps);
  assert.equal(results[0].output, "'Bikes' is busy working on something.");
  assert.deepEqual(busy, [true, false]);
  assert.match(notes[1], /^Claude did not answer: 'Bikes' is busy/);
});

test('non-blocking tools ask for the result to wait until the model is idle', async () => {
  const { deps, results } = harness({ nonBlocking: true });
  await runToolCalls([{ id: 'c1', name: 'ask_claude', args: { request: 'go' } }], deps);
  assert.equal(results[0].scheduling, 'WHEN_IDLE');
});

test('an empty request, a removed tool and a cancelled call are handled', async () => {
  const { deps, results, asked } = harness({ cancelled: ['c3'] });
  await runToolCalls([
    { id: 'c1', name: 'ask_claude', args: { request: '  ' } },
    { id: 'c2', name: 'list_sessions', args: {} },
    { id: 'c3', name: 'ask_claude', args: { request: 'go' } },
  ], deps);
  assert.deepEqual(results.map((result) => result.output), ['The request was empty.', 'Unknown tool list_sessions.']);
  assert.deepEqual(asked, ['go']);
});
