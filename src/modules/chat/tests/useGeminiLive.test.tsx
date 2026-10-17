import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useGeminiLive } from '@/modules/chat/hooks/useGeminiLive';
import type { GeminiLiveStatus } from '@/shared/types';

const micFrames: { push: ((samples: Float32Array) => void) | null } = { push: null };
vi.mock('@/modules/chat/utils/micCapture', () => ({
  startMicCapture: async (onFrame: (samples: Float32Array) => void) => {
    micFrames.push = onFrame;
    return { sampleRate: 16_000, stop: () => { micFrames.push = null; } };
  },
}));
vi.mock('@/modules/chat/utils/geminiAudioPlayer', () => ({
  createGeminiAudioPlayer: () => ({ enqueue() {}, stop() {}, onDrained: (callback: () => void) => callback(), close() {} }),
}));

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; }
  emit(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

const status: GeminiLiveStatus = {
  configured: true, reason: null, model: 'gemini-3.8-live', nonBlockingTools: false, voices: ['Kore'], defaultVoice: 'Kore',
};

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal('WebSocket', FakeSocket);
  let n = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ token: `auth_tokens/t${++n}`, model: 'gemini-3.8-live', expiresAt: '' }), { status: 200 },
  )));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function start(overrides: Partial<Parameters<typeof useGeminiLive>[0]> = {}) {
  const askClaude = vi.fn(async (_request: string) => '**Three** files in src.');
  const onTranscript = vi.fn();
  const getRecap = vi.fn(async (): Promise<string | null> => null);
  const onEnded = vi.fn();
  const hook = renderHook(() => useGeminiLive({
    active: true, runId: 1, status, voice: 'Kore', askClaude, getRecap, onTranscript, onEnded, ...overrides,
  }));
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  return { hook, askClaude, onTranscript, getRecap, onEnded };
}

test('connects with a token, sends setup, and becomes ready after setupComplete', async () => {
  const { hook } = await start();
  const socket = FakeSocket.instances[0];
  assert.match(socket.url, /BidiGenerateContentConstrained\?access_token=auth_tokens%2Ft1$/);
  const setup = socket.sent[0].setup as { model: string; tools: unknown[] };
  assert.equal(setup.model, 'models/gemini-3.8-live');
  assert.equal(hook.result.current.snapshot?.phase, 'connecting');
  await act(async () => { socket.emit({ setupComplete: {} }); await vi.advanceTimersByTimeAsync(5); });
  assert.equal(hook.result.current.snapshot?.phase, 'listening');
});

test('runs ask_claude against the voice session and sends the tool response back', async () => {
  const { askClaude, onTranscript } = await start();
  const socket = FakeSocket.instances[0];
  await act(async () => {
    socket.emit({ setupComplete: {} });
    socket.emit({ toolCall: { functionCalls: [{ id: 'c1', name: 'ask_claude', args: { request: 'count files' } }] } });
    await vi.advanceTimersByTimeAsync(10);
  });
  assert.deepEqual(askClaude.mock.calls[0], ['count files']);
  assert.deepEqual(onTranscript.mock.calls.map((call) => [call[0], call[1]]), [
    ['tool', 'Asked Claude: count files'],
    ['tool', 'Claude replied: Three files in src.'],
  ]);
  const response = socket.sent.find((message) => 'toolResponse' in message) as { toolResponse: { functionResponses: Array<Record<string, unknown>> } };
  assert.equal(response.toolResponse.functionResponses[0].id, 'c1');
  assert.deepEqual(response.toolResponse.functionResponses[0].response, { output: 'Three files in src.' });
});

test('goAway reconnects with a fresh token and the saved resumption handle', async () => {
  await start();
  const first = FakeSocket.instances[0];
  await act(async () => {
    first.emit({ setupComplete: {} });
    first.emit({ sessionResumptionUpdate: { newHandle: 'handle-1', resumable: true } });
    first.emit({ goAway: { timeLeft: '30s' } });
    await vi.advanceTimersByTimeAsync(10);
  });
  assert.equal(FakeSocket.instances.length, 2);
  assert.equal(first.closed, true);
  const second = FakeSocket.instances[1];
  assert.match(second.url, /t2$/);
  assert.deepEqual((second.sent[0].setup as { sessionResumption: unknown }).sessionResumption, { handle: 'handle-1' });
});

test('ends itself after two minutes of silence', async () => {
  const { onEnded } = await start();
  FakeSocket.instances[0].emit({ setupComplete: {} });
  await act(async () => { await vi.advanceTimersByTimeAsync(119_000); });
  assert.equal(onEnded.mock.calls.length, 0);
  await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
  assert.ok(onEnded.mock.calls.length >= 1);
  assert.match(String(onEnded.mock.calls[0][0]), /2 minutes/);
});

test('does not connect, and fails nothing, when the server has no key', async () => {
  const { hook } = await start({ status: { ...status, configured: false } });
  assert.equal(FakeSocket.instances.length, 0);
  assert.equal(hook.result.current.snapshot, null);
});

test('mic audio is streamed only after setup and never while muted', async () => {
  const { hook } = await start();
  const socket = FakeSocket.instances[0];
  const frame = new Float32Array(320).fill(0.01);
  micFrames.push?.(frame);
  assert.equal(socket.sent.filter((message) => 'realtimeInput' in message).length, 0);
  await act(async () => { socket.emit({ setupComplete: {} }); await vi.advanceTimersByTimeAsync(5); });
  micFrames.push?.(frame);
  assert.equal(socket.sent.filter((message) => 'realtimeInput' in message).length, 1);
  act(() => hook.result.current.setMuted(true));
  micFrames.push?.(frame);
  assert.equal(socket.sent.filter((message) => 'realtimeInput' in message).length, 1);
});

test('what Jason says and what the model says are saved as whole turns, in order, with times', async () => {
  const { onTranscript } = await start();
  const socket = FakeSocket.instances[0];
  await act(async () => { socket.emit({ setupComplete: {} }); await vi.advanceTimersByTimeAsync(5); });
  await act(async () => {
    socket.emit({ serverContent: { inputTranscription: { text: 'What is' } } });
    socket.emit({ serverContent: { inputTranscription: { text: ' the plan?' } } });
    await vi.advanceTimersByTimeAsync(5);
  });
  // Nothing is saved while the turn is still being heard.
  assert.equal(onTranscript.mock.calls.length, 0);
  await act(async () => {
    socket.emit({ serverContent: { outputTranscription: { text: 'We ship ' } } });
    socket.emit({ serverContent: { outputTranscription: { text: 'on Friday.' } } });
    socket.emit({ serverContent: { turnComplete: true } });
    await vi.advanceTimersByTimeAsync(5);
  });
  assert.deepEqual(onTranscript.mock.calls.map((call) => [call[0], call[1]]), [
    ['user', 'What is the plan?'],
    ['gemini', 'We ship on Friday.'],
  ]);
  const [first, second] = onTranscript.mock.calls.map((call) => call[2] as number);
  assert.ok(Number.isFinite(first) && second >= first);
});

test('a half-said turn is saved when the call is interrupted or ends, so nothing is lost', async () => {
  const { hook, onTranscript } = await start();
  const socket = FakeSocket.instances[0];
  await act(async () => {
    socket.emit({ setupComplete: {} });
    socket.emit({ serverContent: { outputTranscription: { text: 'Let me think' } } });
    socket.emit({ serverContent: { interrupted: true } });
    await vi.advanceTimersByTimeAsync(5);
  });
  assert.deepEqual(onTranscript.mock.calls.map((call) => [call[0], call[1]]), [['gemini', 'Let me think']]);
  await act(async () => {
    socket.emit({ serverContent: { inputTranscription: { text: 'one more thing' } } });
    await vi.advanceTimersByTimeAsync(5);
  });
  hook.unmount();
  assert.deepEqual(onTranscript.mock.calls.at(-1)?.slice(0, 2), ['user', 'one more thing']);
});

test('a fresh connection gets the recap as quiet context, and a resumed one does not', async () => {
  await start({ getRecap: vi.fn(async () => 'Context: earlier turns.') });
  const first = FakeSocket.instances[0];
  await act(async () => { first.emit({ setupComplete: {} }); await vi.advanceTimersByTimeAsync(5); });
  const contexts = (socket: FakeSocket) => socket.sent.filter((message) => 'clientContent' in message) as Array<{ clientContent: { turns: Array<{ parts: Array<{ text: string }> }>; turnComplete: boolean } }>;
  assert.equal(contexts(first).length, 1);
  assert.equal(contexts(first)[0].clientContent.turnComplete, false);
  assert.equal(contexts(first)[0].clientContent.turns[0].parts[0].text, 'Context: earlier turns.');

  await act(async () => {
    first.emit({ sessionResumptionUpdate: { newHandle: 'h1', resumable: true } });
    first.emit({ goAway: { timeLeft: '30s' } });
    await vi.advanceTimersByTimeAsync(10);
  });
  const second = FakeSocket.instances[1];
  await act(async () => { second.emit({ setupComplete: {} }); await vi.advanceTimersByTimeAsync(5); });
  assert.equal(contexts(second).length, 0);
});

test('a new voice session (new run id) reconnects even though the voice stays on', async () => {
  const askClaude = vi.fn(async () => '');
  const common = { active: true, status, voice: 'Kore', askClaude, getRecap: async () => null, onTranscript: vi.fn(), onEnded: vi.fn() };
  const hook = renderHook(({ runId }: { runId: number }) => useGeminiLive({ ...common, runId }), { initialProps: { runId: 1 } });
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  assert.equal(FakeSocket.instances.length, 1);
  hook.rerender({ runId: 1 });
  assert.equal(FakeSocket.instances.length, 1);
  hook.rerender({ runId: 2 });
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  assert.equal(FakeSocket.instances.length, 2);
  assert.equal(FakeSocket.instances[0].closed, true);
});

test('a dropped connection ends the session instead of leaving it looking alive', async () => {
  const { onEnded } = await start();
  const socket = FakeSocket.instances[0];
  await act(async () => { socket.emit({ setupComplete: {} }); await vi.advanceTimersByTimeAsync(5); });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = FakeSocket.instances.at(-1)!;
    await act(async () => { current.onclose?.(); await vi.advanceTimersByTimeAsync(20); });
  }
  assert.equal(onEnded.mock.calls.length, 1);
  assert.match(String(onEnded.mock.calls[0][0]), /dropped/);
});
