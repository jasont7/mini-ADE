import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useVoiceBridge } from '@/modules/chat/hooks/useVoiceBridge';
import type { ServerEvent, VoiceDirectory, VoiceTarget } from '@/shared/types';

const socket = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  listeners: new Set<(event: ServerEvent) => void>(),
  preferences: {} as Record<string, unknown>,
}));
vi.mock('@/shared/context/WebSocketContext', () => ({
  useWebSocket: () => ({
    sendMessage: socket.sendMessage,
    subscribe: (listener: (event: ServerEvent) => void) => {
      socket.listeners.add(listener);
      return () => socket.listeners.delete(listener);
    },
  }),
}));
vi.mock('@/shared/userSettings', () => ({
  readUserPreference: (key: string, fallback: unknown) => socket.preferences[key] ?? fallback,
}));

const frame = (event: ServerEvent) => act(() => { socket.listeners.forEach((listener) => listener(event)); });

const directory: VoiceDirectory = {
  sessions: [{ id: 's1', name: 'Bikes', projectName: 'life', provider: 'codex' }],
  busyIds: new Set(),
  openSession: () => undefined,
  markSessionProcessing: () => undefined,
  establishSession: () => undefined,
};
const target = (): VoiceTarget | null => null;

beforeEach(() => {
  socket.sendMessage.mockClear();
  socket.listeners.clear();
  socket.preferences = {};
});

function mountBridge() {
  const hook = renderHook(() => useVoiceBridge({ getTarget: target, getDirectory: () => directory }));
  return { hook };
}

test('frames from the websocket answer a request, and the message goes out over the same socket', async () => {
  const { hook } = mountBridge();
  let answer!: Promise<string>;
  act(() => { answer = hook.result.current.askSession('s1', 'compare'); });
  assert.equal(socket.sendMessage.mock.calls.length, 1);
  assert.deepEqual(socket.sendMessage.mock.calls[0][0], {
    type: 'chat.send',
    sessionId: 's1',
    content: '[voice] compare',
    options: { toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: false }, skipPermissions: false, sessionSummary: 'Bikes' },
  });
  frame({ kind: 'text', sessionId: 's1', role: 'assistant', content: 'Bike A.', id: 't1' });
  frame({ kind: 'complete', sessionId: 's1', success: true });
  assert.equal(await answer, 'Bike A.');
});

test("a session's saved tool permissions travel with the message, by its provider", () => {
  socket.preferences.codexPermissions = { allowedTools: ['x'], disallowedTools: [], skipPermissions: true };
  const { hook } = mountBridge();
  act(() => { void hook.result.current.askSession('s1', 'go').catch(() => undefined); });
  const options = (socket.sendMessage.mock.calls[0][0] as { options: { skipPermissions: boolean; toolsSettings: unknown } }).options;
  assert.equal(options.skipPermissions, true);
  assert.deepEqual(options.toolsSettings, { allowedTools: ['x'], disallowedTools: [], skipPermissions: true });
});

test('unmounting stops listening and rejects waiting requests', async () => {
  const { hook } = mountBridge();
  let answer!: Promise<string>;
  act(() => { answer = hook.result.current.askSession('s1', 'go'); });
  const outcome = assert.rejects(answer, /app closed/);
  hook.unmount();
  await outcome;
  assert.equal(socket.listeners.size, 0);
});
