import assert from 'node:assert/strict';

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import VoiceButtons from '@/modules/chat/composer/VoiceButtons';
import { useLiveVoice } from '@/modules/chat/hooks/useLiveVoice';
import { useSessionVoiceSettings } from '@/modules/chat/hooks/useSessionVoiceSettings';
import type { VoiceSessionHub } from '@/modules/chat/utils/voiceSessionHub';
import type { VoiceInputState } from '@/shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// The connection itself is covered by the Gemini Live hook tests. Here it only reports a phase while active.
vi.mock('@/modules/chat/hooks/useGeminiLive', () => ({
  useGeminiLive: (options: { active: boolean }) => ({
    snapshot: options.active ? { phase: 'listening', muted: false, error: null } : null,
    setMuted: () => undefined,
  }),
}));

// Nothing in these tests reaches the hub; the live hooks only hold on to it.
const stubHub = {
  handleEvent: () => undefined,
  askSession: async () => '',
  bindNewSession: () => undefined,
  dispose: () => undefined,
} satisfies VoiceSessionHub;

const liveArgs = (sessionId: string | null) => ({
  sessionId,
  hub: stubHub,
  getDirectory: () => null,
  getTarget: () => (sessionId ? { sessionId, sessionName: 'Bikes', projectName: 'life', submitText: () => undefined } : null),
  followDirectoryRef: { current: null },
});

type Call = { url: string; method: string };
let calls: Call[] = [];
let stored: Record<string, unknown> = {};
let geminiStatus: Record<string, unknown>;

beforeEach(() => {
  calls = [];
  stored = {};
  geminiStatus = {
    configured: true, reason: null, model: 'm', nonBlockingTools: false, voices: ['Kore'], defaultVoice: 'Kore',
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    if (url === '/api/voice/gemini/status') return json(geminiStatus);
    const match = url.match(/\/api\/voice\/sessions\/([^/]+)\/mode/);
    if (match && method === 'PUT') {
      stored[match[1]] = JSON.parse(String(init?.body));
      return json(stored[match[1]]);
    }
    if (match) return json(stored[match[1]] ?? { mode: 'off', geminiVoice: null });
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function Harness({
  sessionId,
  voiceState = 'idle',
  dictationAvailable = true,
  voiceToggle = () => undefined,
}: {
  sessionId: string | null;
  voiceState?: VoiceInputState;
  dictationAvailable?: boolean;
  voiceToggle?: () => void;
}) {
  const live = useLiveVoice(liveArgs(sessionId));
  return <VoiceButtons voiceState={voiceState} voiceToggle={voiceToggle} dictationAvailable={dictationAvailable} live={live} />;
}

const geminiButton = () => screen.getByRole('button', { name: /liveVoice\.(modes\.gemini|end|gemini)/ });

test('shows a Dictate and a Gemini Live button side by side and no menu', async () => {
  render(<Harness sessionId="s1" />);
  await waitFor(() => assert.equal(geminiButton().getAttribute('aria-disabled'), 'false'));
  assert.equal(screen.getAllByRole('button').length, 2);
  assert.equal(screen.queryByRole('menu'), null);
  assert.match(geminiButton().getAttribute('aria-label') ?? '', /liveVoice\.audioToGoogle/);
  // Both are at least 40 px on narrow screens.
  for (const button of screen.getAllByRole('button')) assert.match(button.className, /max-md:h-10 max-md:w-10/);
});

test('Dictate is a single tap that toggles recording', () => {
  const toggle = vi.fn();
  render(<Harness sessionId="s1" voiceToggle={toggle} />);
  fireEvent.click(screen.getByRole('button', { name: 'voice.input' }));
  assert.equal(toggle.mock.calls.length, 1);
});

test('Dictate shows the stop tooltip while recording and is absent without a speech server', () => {
  const { rerender } = render(<Harness sessionId="s1" voiceState="recording" />);
  assert.ok(screen.getByRole('button', { name: 'voice.stopRecording' }));
  rerender(<Harness sessionId="s1" dictationAvailable={false} />);
  assert.equal(screen.queryByRole('button', { name: 'voice.input' }), null);
});

test('Gemini Live is disabled with the reason when the server has no key', async () => {
  geminiStatus = { ...geminiStatus, configured: false, reason: 'Add GEMINI_API_KEY to the server .env to enable Gemini Live.' };
  render(<Harness sessionId="s1" />);
  const button = await screen.findByRole('button', { name: /GEMINI_API_KEY/ });
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  fireEvent.click(button);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
});

test('Gemini Live is disabled in a chat with no session yet, and says what to do', async () => {
  render(<Harness sessionId={null} />);
  const button = await screen.findByRole('button', { name: 'liveVoice.geminiNeedsSession' });
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  fireEvent.click(button);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
});

test('tapping Gemini Live starts it, shows the on state and phase dot, and tapping again ends it', async () => {
  render(<Harness sessionId="s1" />);
  await waitFor(() => assert.equal(geminiButton().getAttribute('aria-disabled'), 'false'));
  await act(async () => fireEvent.click(geminiButton()));
  assert.equal(geminiButton().getAttribute('aria-pressed'), 'true');
  assert.equal(screen.getByTestId('gemini-phase-dot').getAttribute('data-phase'), 'listening');
  assert.match(geminiButton().getAttribute('aria-label') ?? '', /liveVoice\.end/);
  await waitFor(() => assert.deepEqual(stored.s1, { mode: 'gemini', geminiVoice: null }));
  // Dictation yields to the running session.
  assert.equal(screen.getByRole('button', { name: 'liveVoice.dictateWhileLive' }).getAttribute('aria-disabled'), 'true');

  await act(async () => fireEvent.click(geminiButton()));
  assert.equal(geminiButton().getAttribute('aria-pressed'), 'false');
  assert.equal(screen.queryByTestId('gemini-phase-dot'), null);
});

test('a saved mode of private (an old row) reads as off and never starts anything', async () => {
  stored.s5 = { mode: 'private', geminiVoice: null };
  const { result } = renderHook(() => useLiveVoice(liveArgs('s5')));
  await waitFor(() => assert.ok(calls.some((call) => call.url.includes('/sessions/s5/mode'))));
  await waitFor(() => assert.equal(result.current.mode, 'off'));
  assert.equal(result.current.running, false);

  const settings = renderHook(() => useSessionVoiceSettings('s5'));
  await waitFor(() => assert.ok(calls.filter((call) => call.url.includes('/sessions/s5/mode')).length >= 2));
  assert.deepEqual(settings.result.current.settings, { mode: 'off', geminiVoice: null });
});

test('a mode picked before the first send is saved once the session id exists', async () => {
  const { result, rerender } = renderHook(({ id }: { id: string | null }) => useSessionVoiceSettings(id), {
    initialProps: { id: null as string | null },
  });
  act(() => result.current.update({ mode: 'gemini', geminiVoice: null }));
  assert.equal(calls.filter((call) => call.method === 'PUT').length, 0);
  rerender({ id: 'new-session' });
  await waitFor(() => assert.deepEqual(stored['new-session'], { mode: 'gemini', geminiVoice: null }));
  assert.equal(result.current.settings.mode, 'gemini');
});

test('opening a session loads its stored mode', async () => {
  stored.s3 = { mode: 'gemini', geminiVoice: 'Kore' };
  const { result } = renderHook(() => useSessionVoiceSettings('s3'));
  await waitFor(() => assert.equal(result.current.settings.mode, 'gemini'));
});
