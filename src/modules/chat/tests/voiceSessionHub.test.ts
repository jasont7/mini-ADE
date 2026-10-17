import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { createVoiceSessionHub } from '@/modules/chat/utils/voiceSessionHub';
import type { ServerEvent, VoiceDirectory, VoiceSessionEntry, VoiceTarget } from '@/shared/types';

const NOW = 1_800_000_000_000;
const entry = (id: string, name: string, projectName: string): VoiceSessionEntry => ({ id, name, projectName });

function setup(options: { onScreen?: string | null } = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const submitted: string[] = [];
  const marked: string[] = [];
  const busy = new Set<string>();
  const sessions = [
    entry('s-voice', 'Voice, Oct 11 15:40', 'life'),
    entry('s-other', 'Bikes', 'life'),
    entry('s-letter', 'Contract letter', 'business'),
  ];
  const directory: VoiceDirectory = {
    sessions,
    busyIds: busy,
    openSession: () => undefined,
    markSessionProcessing: (id) => { marked.push(id); busy.add(id); },
    establishSession: () => undefined,
  };
  const state = { target: options.onScreen === undefined ? 's-other' : options.onScreen };
  const getTarget = (): VoiceTarget | null => (state.target === undefined
    ? null
    : {
      sessionId: state.target,
      sessionName: sessions.find((item) => item.id === state.target)?.name ?? null,
      projectName: 'life',
      submitText: (text) => { submitted.push(text); },
    });
  const hub = createVoiceSessionHub({
    send: (frame) => sent.push(frame),
    getDirectory: () => directory,
    getTarget,
    buildSendOptions: (item) => ({ sessionSummary: item.name }),
    now: () => Date.now(),
  });
  const emit = (event: ServerEvent) => hub.handleEvent(event);
  const reply = (sessionId: string, text: string, id = `row-${Math.random()}`) => emit({ kind: 'text', sessionId, role: 'assistant', content: text, id });
  const complete = (sessionId: string) => emit({ kind: 'complete', sessionId, success: true });
  return { hub, sent, submitted, marked, busy, emit, reply, complete, state };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

test('a request to the voice session goes over chat.send even while another session is on screen', async () => {
  const { hub, sent, submitted, marked, reply, complete } = setup({ onScreen: 's-other' });
  const answer = hub.askSession('s-voice', 'draft the letter');
  assert.deepEqual(submitted, []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'chat.send');
  assert.equal(sent[0].sessionId, 's-voice');
  assert.equal(sent[0].content, '[voice] draft the letter');
  assert.deepEqual(sent[0].options, { sessionSummary: 'Voice, Oct 11 15:40' });
  assert.deepEqual(marked, ['s-voice']);

  // Frames of the session on screen never answer it.
  reply('s-other', 'Not for you.');
  complete('s-other');
  reply('s-voice', 'Draft is ready.');
  complete('s-voice');
  assert.equal(await answer, 'Draft is ready.');
});

test('a request for the voice session while it is on screen goes through its composer', async () => {
  const { hub, sent, submitted, reply, complete } = setup({ onScreen: 's-voice' });
  const answer = hub.askSession('s-voice', 'summarise');
  assert.deepEqual(submitted, ['[voice] summarise']);
  assert.deepEqual(sent, []);
  reply('s-voice', 'Three bikes.');
  complete('s-voice');
  assert.equal(await answer, 'Three bikes.');
});

test('with no id, the request means the session on screen (Private live)', async () => {
  const { hub, submitted, reply, complete } = setup({ onScreen: 's-other' });
  const answer = hub.askSession(undefined, 'hello');
  assert.deepEqual(submitted, ['[voice] hello']);
  reply('s-other', 'Hi.');
  complete('s-other');
  assert.equal(await answer, 'Hi.');
});

test('requests to different sessions are in flight together and each gets its own reply', async () => {
  const { hub, sent, reply, complete } = setup();
  const letter = hub.askSession('s-letter', 'draft it');
  const voice = hub.askSession('s-voice', 'compare');
  assert.equal(sent.length, 2);
  reply('s-voice', 'Bike A wins.');
  complete('s-voice');
  reply('s-letter', 'Letter drafted.');
  complete('s-letter');
  assert.equal(await voice, 'Bike A wins.');
  assert.equal(await letter, 'Letter drafted.');
});

test('a second request to a session with a request waiting is refused, not queued', async () => {
  const { hub, sent } = setup();
  void hub.askSession('s-voice', 'one');
  await assert.rejects(hub.askSession('s-voice', 'two'), /already has a voice request running/);
  assert.equal(sent.length, 1);
});

test('a session that is busy with other work is refused with a clear result', async () => {
  const { hub, sent, busy } = setup();
  busy.add('s-voice');
  await assert.rejects(hub.askSession('s-voice', 'hello'), /'Voice, Oct 11 15:40' is busy working on something/);
  assert.equal(sent.length, 0);
});

test('a session waiting for permission is refused and says why', async () => {
  const { hub, emit } = setup();
  emit({ kind: 'permission_request', sessionId: 's-voice', requestId: 'r1', toolName: 'Bash' });
  await assert.rejects(hub.askSession('s-voice', 'hello'), /waiting for permission/);
});

test('a permission request during a request answers it at once', async () => {
  const { hub, emit } = setup();
  const answer = hub.askSession('s-letter', 'go');
  emit({ kind: 'status', sessionId: 's-letter', text: 'working' });
  emit({ kind: 'permission_request', sessionId: 's-letter', requestId: 'r9', toolName: 'Bash' });
  assert.match(await answer, /'Contract letter' is waiting for permission to use Bash/);
});

test('a run that cannot start (server refuses) rejects the request with the server message', async () => {
  const { hub, emit } = setup();
  const answer = hub.askSession('s-letter', 'go');
  emit({ kind: 'protocol_error', sessionId: 's-letter', code: 'RUN_IN_PROGRESS', error: 'Session already has a run in progress.' });
  await assert.rejects(answer, /already has a run in progress/);
});

test('a complete frame left over from an earlier run does not answer the new request', async () => {
  const { hub, complete, reply } = setup();
  const answer = hub.askSession('s-letter', 'go');
  complete('s-letter');
  let settled = false;
  void answer.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  reply('s-letter', 'Done.');
  complete('s-letter');
  assert.equal(await answer, 'Done.');
});

test('a request that never starts fails after the start timeout', async () => {
  const { hub } = setup();
  const answer = hub.askSession('s-letter', 'go');
  const outcome = assert.rejects(answer, /did not start/);
  await vi.advanceTimersByTimeAsync(21_000);
  await outcome;
});

test('streamed text answers when no text row arrives', async () => {
  const { hub, emit, complete } = setup();
  const answer = hub.askSession('s-letter', 'go');
  emit({ kind: 'stream_delta', sessionId: 's-letter', content: 'Hello ' });
  emit({ kind: 'stream_delta', sessionId: 's-letter', content: 'there.' });
  emit({ kind: 'stream_end', sessionId: 's-letter' });
  complete('s-letter');
  assert.equal(await answer, 'Hello there.');
});

test('a new chat takes a request through its composer and follows the session id it gets', async () => {
  const { hub, submitted, emit, reply, complete, state } = setup({ onScreen: null });
  const answer = hub.askSession(undefined, 'start something');
  assert.deepEqual(submitted, ['[voice] start something']);
  // Frames arrive for the new session before the chat reports its id.
  emit({ kind: 'status', sessionId: 's-new', text: 'working' });
  reply('s-new', 'Started.');
  complete('s-new');
  state.target = 's-new';
  hub.bindNewSession('s-new');
  assert.equal(await answer, 'Started.');
});

test('ending the voice session rejects requests that are still waiting', async () => {
  const { hub } = setup();
  const answer = hub.askSession('s-letter', 'go');
  const outcome = assert.rejects(answer, /voice session ended/);
  hub.dispose('The voice session ended.');
  await outcome;
});

test('with no chat open and no id, the request is refused', async () => {
  const { hub, state } = setup();
  state.target = undefined as unknown as string;
  await assert.rejects(hub.askSession(undefined, 'hi'), /No chat is open/);
});

test('the sidekick surface is gone from the hub', () => {
  const { hub } = setup();
  for (const removed of ['listSessions', 'readSession', 'openSession', 'setAnnounceAll', 'hasPending']) {
    assert.equal(removed in hub, false, removed);
  }
});
