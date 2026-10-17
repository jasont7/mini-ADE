import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { createVoiceTranscriptStore } from '@/modules/chat/utils/voiceTranscriptStore';
import type { VoiceTranscriptEntry } from '@/shared/types';

const entry = (id: string, at: number, text = id, role: VoiceTranscriptEntry['role'] = 'user'): VoiceTranscriptEntry => ({ id, role, text, at });

// A stand-in for the server: what was saved is what a later load returns, as after a page reload.
function fakeServer() {
  const saved = new Map<string, VoiceTranscriptEntry[]>();
  const state = { online: true, writes: 0 };
  return {
    saved,
    state,
    save: async (sessionId: string, entries: VoiceTranscriptEntry[]) => {
      state.writes += 1;
      if (!state.online) return false;
      const list = saved.get(sessionId) ?? [];
      for (const item of entries) if (!list.some((existing) => existing.id === item.id)) list.push(item);
      saved.set(sessionId, list);
      return true;
    },
    load: async (sessionId: string) => [...(saved.get(sessionId) ?? [])].sort((a, b) => a.at - b.at),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test('an appended entry is readable at once, subscribers hear about it, and it is saved', async () => {
  const server = fakeServer();
  const store = createVoiceTranscriptStore(server);
  const heard = vi.fn();
  store.subscribe(heard);
  store.append('s1', entry('a', 1));
  assert.deepEqual(store.get('s1').map((item) => item.id), ['a']);
  assert.equal(heard.mock.calls.length, 1);
  await vi.advanceTimersByTimeAsync(0);
  assert.deepEqual(server.saved.get('s1')?.map((item) => item.id), ['a']);
});

test('entries are ordered by time, ties keep arrival order, and the same array comes back until something changes', () => {
  const store = createVoiceTranscriptStore(fakeServer());
  store.append('s1', entry('late', 30));
  store.append('s1', entry('early', 10));
  store.append('s1', entry('tie-1', 20));
  store.append('s1', entry('tie-2', 20));
  assert.deepEqual(store.get('s1').map((item) => item.id), ['early', 'tie-1', 'tie-2', 'late']);
  assert.equal(store.get('s1'), store.get('s1'));
  assert.equal(store.get('nothing'), store.get('nothing'));
});

test('a new store loads what was saved, which is how a conversation survives a reload', async () => {
  const server = fakeServer();
  const before = createVoiceTranscriptStore(server);
  before.append('s1', entry('a', 1, 'hello', 'user'));
  before.append('s1', entry('b', 2, 'hi there', 'gemini'));
  await vi.advanceTimersByTimeAsync(0);

  const after = createVoiceTranscriptStore(server);
  assert.deepEqual(after.get('s1'), []);
  await after.load('s1');
  assert.deepEqual(after.get('s1').map((item) => [item.role, item.text]), [['user', 'hello'], ['gemini', 'hi there']]);
});

test('loading merges with entries added meanwhile and never duplicates', async () => {
  const server = fakeServer();
  server.saved.set('s1', [entry('a', 1), entry('b', 2)]);
  const store = createVoiceTranscriptStore(server);
  store.append('s1', entry('b', 2));
  store.append('s1', entry('c', 3));
  await store.load('s1');
  assert.deepEqual(store.get('s1').map((item) => item.id), ['a', 'b', 'c']);
});

test('an entry that could not be saved is kept and tried again until the server takes it', async () => {
  const server = fakeServer();
  server.state.online = false;
  const store = createVoiceTranscriptStore(server);
  store.append('s1', entry('a', 1));
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(server.saved.get('s1'), undefined);
  assert.equal(store.get('s1').length, 1);

  server.state.online = true;
  await vi.advanceTimersByTimeAsync(3_100);
  assert.deepEqual(server.saved.get('s1')?.map((item) => item.id), ['a']);
  const writes = server.state.writes;
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(server.state.writes, writes, 'nothing is sent twice once it is saved');
});

test('entries added while a write is in flight are saved right after it', async () => {
  const server = fakeServer();
  const store = createVoiceTranscriptStore(server);
  store.append('s1', entry('a', 1));
  store.append('s1', entry('b', 2));
  await vi.advanceTimersByTimeAsync(0);
  assert.deepEqual(server.saved.get('s1')?.map((item) => item.id), ['a', 'b']);
});

test('flush sends what is waiting without waiting for the retry timer', async () => {
  const server = fakeServer();
  server.state.online = false;
  const store = createVoiceTranscriptStore(server);
  store.append('s1', entry('a', 1));
  await vi.advanceTimersByTimeAsync(0);
  server.state.online = true;
  store.flush();
  await vi.advanceTimersByTimeAsync(0);
  assert.deepEqual(server.saved.get('s1')?.map((item) => item.id), ['a']);
});
