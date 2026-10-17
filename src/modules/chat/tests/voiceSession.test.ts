import assert from 'node:assert/strict';

import { test, vi } from 'vitest';

import {
  buildVoiceRecap,
  createVoiceSession,
  defaultVoiceSessionName,
  mergeVoiceRows,
  RECAP_ENTRY_COUNT,
  VOICE_SESSION_INTRO,
} from '@/modules/chat/utils/voiceSession';
import type { ChatMessage, VoiceTranscriptEntry } from '@/shared/types';

const entry = (id: string, at: number, text: string, role: VoiceTranscriptEntry['role'] = 'user'): VoiceTranscriptEntry => ({ id, role, text, at });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('the default name is "Voice, Oct 11 15:40" and is exactly the four words the server keeps', () => {
  assert.equal(defaultVoiceSessionName(new Date(2026, 9, 11, 15, 40)), 'Voice, Oct 11 15:40');
  assert.equal(defaultVoiceSessionName(new Date(2026, 0, 3, 9, 5)), 'Voice, Jan 3 09:05');
  assert.equal(defaultVoiceSessionName(new Date(2026, 9, 11, 15, 40)).split(/\s+/).length, 4);
});

test('the intro tells Claude it is a voice session, to keep replies to 1 to 4 short plain sentences, and to wait', () => {
  assert.match(VOICE_SESSION_INTRO, /voice session/);
  assert.match(VOICE_SESSION_INTRO, /1 to 4 short plain sentences/);
  assert.match(VOICE_SESSION_INTRO, /Wait for his requests/);
  assert.match(VOICE_SESSION_INTRO, /only the word Ready/);
});

test('creating a voice session asks the server for a session in the project, then marks it', async () => {
  const createSession = vi.fn(async (_payload: unknown) => reply({ data: { sessionId: 'abc-1', sessionName: 'Voice, Oct 11 15:40' } }, 201));
  const registerVoiceSession = vi.fn(async (_id: string, _name: string | null) => reply({ sessionId: 'abc-1' }));
  const created = await createVoiceSession({ createSession, registerVoiceSession }, { projectPath: '/work/life', now: new Date(2026, 9, 11, 15, 40) });
  assert.deepEqual(created, { sessionId: 'abc-1', name: 'Voice, Oct 11 15:40' });
  assert.deepEqual(createSession.mock.calls[0][0], { provider: 'claude', projectPath: '/work/life', initialMessage: 'Voice, Oct 11 15:40' });
  assert.deepEqual(registerVoiceSession.mock.calls[0], ['abc-1', 'Voice, Oct 11 15:40']);
});

test('creating fails with a plain sentence when the server refuses or answers without an id', async () => {
  const ok = async () => reply({ sessionId: 'x' });
  await assert.rejects(
    createVoiceSession({ createSession: async () => reply({}, 500), registerVoiceSession: ok }, { projectPath: '/p', now: new Date() }),
    /Could not create the session \(500\)/,
  );
  await assert.rejects(
    createVoiceSession({ createSession: async () => reply({ data: {} }, 201), registerVoiceSession: ok }, { projectPath: '/p', now: new Date() }),
    /no session id/,
  );
  await assert.rejects(
    createVoiceSession({ createSession: async () => reply({ data: { sessionId: 'a' } }, 201), registerVoiceSession: async () => reply({}, 503) }, { projectPath: '/p', now: new Date() }),
    /Could not mark the session as a voice session \(503\)/,
  );
});

test('the recap holds the last few turns, in order, and nothing when nothing was said', () => {
  assert.equal(buildVoiceRecap([]), null);
  const entries = Array.from({ length: 12 }, (_, index) => entry(`e${index}`, index, `line ${index}`, index % 2 ? 'gemini' : 'user'));
  const recap = buildVoiceRecap(entries)!;
  const lines = recap.split('\n').filter((line) => /^(Jason|You|Claude):/.test(line));
  assert.equal(lines.length, RECAP_ENTRY_COUNT);
  assert.equal(lines[0], 'Jason: line 4');
  assert.equal(lines.at(-1), 'You: line 11');
  assert.match(recap, /^Context:/);
});

test('a long entry is trimmed to one line in the recap', () => {
  const recap = buildVoiceRecap([entry('a', 1, `${'word '.repeat(200)}\nsecond`, 'tool')])!;
  const line = recap.split('\n').find((item) => item.startsWith('Claude:'))!;
  assert.ok(line.length < 260 && line.endsWith('…'));
});

const claude = (type: 'user' | 'assistant', content: string, at: number): ChatMessage => ({ type, content, timestamp: new Date(at).toISOString() });

test("voice rows are woven between Claude's rows by time, and Claude's own order is untouched", () => {
  const messages = [claude('user', '[voice] list files', 1_000), claude('assistant', 'Three files.', 3_000), claude('assistant', 'Anything else?', 5_000)];
  const entries = [entry('v1', 500, 'list the files', 'user'), entry('v2', 2_000, 'On it.', 'gemini'), entry('v3', 4_000, 'Three files.', 'gemini'), entry('v4', 9_000, 'Bye.', 'gemini')];
  const merged = mergeVoiceRows(messages, entries);
  assert.deepEqual(merged.map((row) => row.content), ['list the files', '[voice] list files', 'On it.', 'Three files.', 'Three files.', 'Anything else?', 'Bye.']);
  assert.deepEqual(merged.filter((row) => row.type === 'voice').map((row) => row.voiceRole), ['user', 'gemini', 'gemini', 'gemini']);
  assert.equal(merged[0].id, 'v1');
});

test('the intro message that sets up a voice session is not shown', () => {
  const messages = [claude('user', `[voice] ${VOICE_SESSION_INTRO}`, 1), claude('assistant', 'Ready.', 2), claude('user', 'real question', 3)];
  assert.deepEqual(mergeVoiceRows(messages, []).map((row) => row.content), ['Ready.', 'real question']);
});

test('while older rows of Claude are not loaded, voice rows from before the loaded window wait too', () => {
  const messages = [claude('assistant', 'later', 5_000)];
  const entries = [entry('old', 1_000, 'old'), entry('new', 6_000, 'new')];
  assert.deepEqual(mergeVoiceRows(messages, entries, true).map((row) => row.content), ['later', 'new']);
  assert.deepEqual(mergeVoiceRows(messages, entries, false).map((row) => row.content), ['old', 'later', 'new']);
});
