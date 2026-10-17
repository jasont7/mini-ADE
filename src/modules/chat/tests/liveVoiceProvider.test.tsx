import assert from 'node:assert/strict';

import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import {
  LiveVoiceProvider,
  useLiveVoiceController,
  useRegisterVoiceDirectory,
  useRegisterVoiceTarget,
} from '@/modules/chat/context/LiveVoiceContext';
import type { LiveVoiceController } from '@/modules/chat/hooks/useLiveVoice';
import { voiceTranscriptStore } from '@/modules/chat/utils/voiceTranscriptStore';
import type { Project, ServerEvent, SessionEstablishedContext, VoiceDirectory, VoiceTranscriptRole } from '@/shared/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/chat/hooks/useVoiceAvailable', () => ({ useVoiceAvailable: () => true }));

const socket = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  listeners: new Set<(event: unknown) => void>(),
}));
vi.mock('@/shared/context/WebSocketContext', () => {
  // Stable between renders, as the real context's functions are.
  const value = {
    sendMessage: socket.sendMessage,
    subscribe: (listener: (event: unknown) => void) => {
      socket.listeners.add(listener);
      return () => { socket.listeners.delete(listener); };
    },
  };
  return { useWebSocket: () => value };
});
const frame = (event: ServerEvent) => act(() => { socket.listeners.forEach((listener) => listener(event)); });

// The live hooks are replaced by recorders: what matters here is when they are active and what they are handed.
type GeminiOptions = {
  active: boolean;
  runId: number;
  askClaude(request: string): Promise<string>;
  getRecap(): Promise<string | null>;
  onTranscript(role: VoiceTranscriptRole, text: string, at: number): void;
  onEnded(reason: string): void;
};
const live = vi.hoisted(() => ({
  geminiActive: [] as boolean[],
  runIds: [] as number[],
  gemini: null as null | GeminiOptions,
  onEnded: null as null | ((reason: string) => void),
  status: { configured: true, reason: null, model: 'm', nonBlockingTools: false, voices: ['Kore'], defaultVoice: 'Kore' } as Record<string, unknown>,
}));
vi.mock('@/modules/chat/hooks/useGeminiLive', () => ({
  useGeminiLive: (options: GeminiOptions) => {
    live.geminiActive.push(options.active);
    live.runIds.push(options.runId);
    live.gemini = options;
    live.onEnded = options.onEnded;
    return { snapshot: options.active ? { phase: 'listening', muted: false, error: null } : null, setMuted: () => undefined };
  },
}));
vi.mock('@/shared/hooks/useGeminiLiveStatus', () => ({ useGeminiLiveStatus: () => live.status }));

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let stored: Record<string, unknown> = {};
let saved: Record<string, Array<{ id: string; role: string; text: string; at: number }>> = {};
let createdCount = 0;
let failRegister = false;

beforeEach(() => {
  stored = {};
  saved = {};
  calls = [];
  createdCount = 0;
  failRegister = false;
  live.geminiActive = [];
  live.runIds = [];
  live.gemini = null;
  live.onEnded = null;
  socket.sendMessage.mockClear();
  socket.listeners.clear();
  live.status = { configured: true, reason: null, model: 'm', nonBlockingTools: false, voices: ['Kore'], defaultVoice: 'Kore' };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    const mode = url.match(/\/api\/voice\/sessions\/([^/]+)\/mode/);
    if (mode && method === 'PUT') {
      stored[mode[1]] = body;
      return json(body);
    }
    if (mode) return json(stored[mode[1]] ?? { mode: 'off', geminiVoice: null });
    if (url === '/api/providers/sessions' && method === 'POST') {
      createdCount += 1;
      return json({ success: true, data: { sessionId: `voice-${createdCount}`, sessionName: body.initialMessage } }, 201);
    }
    if (url === '/api/voice/sessions' && method === 'GET') return json({ sessionIds: ['old-voice'] });
    const transcript = url.match(/\/api\/voice\/sessions\/([^/]+)\/transcript/);
    if (transcript && method === 'POST') {
      saved[transcript[1]] = [...(saved[transcript[1]] ?? []), ...body.entries];
      return json({ added: body.entries.length });
    }
    if (transcript) return json({ entries: saved[transcript[1]] ?? [] });
    const register = url.match(/\/api\/voice\/sessions\/([^/]+)$/);
    if (register && method === 'PUT') return failRegister ? json({ error: 'no' }, 500) : json({ sessionId: register[1] });
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type ChatProps = { sessionId: string | null; name: string | null; project?: string; submitted: string[] };
let controller!: LiveVoiceController;

const SIDEBAR = [
  { id: 's1', name: 'Bikes', projectName: 'life' },
  { id: 's2', name: 'Back pain', projectName: 'health' },
];

const PROJECT = { projectId: 'p1', displayName: 'life', fullPath: '/work/life' } as Project;

type Workspace = { opened: string[]; established: Array<[string, SessionEstablishedContext]>; busy?: string[]; sessions?: Array<{ id: string; name: string; projectName: string }> };

// Stands in for the project workspace: tells the provider which sessions the sidebar lists.
function FakeWorkspace({ workspace }: { workspace: Workspace }) {
  const directory: VoiceDirectory = {
    sessions: workspace.sessions ?? SIDEBAR,
    busyIds: new Set(workspace.busy ?? []),
    openSession: (id) => { workspace.opened.push(id); },
    markSessionProcessing: () => undefined,
    establishSession: (id, context) => { workspace.established.push([id, context]); },
  };
  useRegisterVoiceDirectory(directory);
  return null;
}

// Stands in for the chat interface: registers the session on screen and reads the controller.
function FakeChat({ sessionId, name, project = 'life', submitted }: ChatProps) {
  useRegisterVoiceTarget({
    sessionId, sessionName: name, projectName: project,
    submitText: (text) => { submitted.push(`${sessionId ?? 'new'}:${text}`); },
  });
  const value = useLiveVoiceController();
  useEffect(() => { controller = value; });
  return null;
}

function mount(props: ChatProps, workspace: Workspace = { opened: [], established: [] }) {
  const tree = (chat: ChatProps | null) => (
    <LiveVoiceProvider>
      <FakeWorkspace workspace={workspace} />
      {chat && <FakeChat {...chat} />}
    </LiveVoiceProvider>
  );
  const view = render(tree(props));
  return {
    workspace,
    switchTo: (next: ChatProps) => view.rerender(tree(next)),
    unmountChat: () => view.rerender(tree(null)),
  };
}

const chat = (sessionId: string | null, name: string | null, submitted: string[], project = 'life'): ChatProps => ({ sessionId, name, project, submitted });
const wsSends = () => socket.sendMessage.mock.calls.map((call) => call[0] as { sessionId: string; content: string; type: string });
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

async function startVoice(view: ReturnType<typeof mount>, submitted: string[], project = PROJECT) {
  act(() => controller.startVoiceSession(project));
  await waitFor(() => assert.ok(controller.voiceSession?.sessionId));
  return { sessionId: controller.voiceSession!.sessionId!, submitted, view };
}

test('New Voice Session creates a real session in the project, marks it, shows it in the sidebar and opens it', async () => {
  const submitted: string[] = [];
  const view = mount(chat('s1', 'Bikes', submitted));
  vi.setSystemTime(new Date(2026, 9, 11, 15, 40));
  const { sessionId } = await startVoice(view, submitted);
  vi.useRealTimers();
  assert.equal(sessionId, 'voice-1');
  const create = calls.find((call) => call.url === '/api/providers/sessions')!;
  assert.deepEqual({ provider: (create.body as { provider: string }).provider, projectPath: (create.body as { projectPath: string }).projectPath }, { provider: 'claude', projectPath: '/work/life' });
  assert.match((create.body as { initialMessage: string }).initialMessage, /^Voice, \w{3} \d{1,2} \d{2}:\d{2}$/);
  assert.ok(calls.some((call) => call.url === '/api/voice/sessions/voice-1' && call.method === 'PUT'));
  assert.deepEqual(view.workspace.established.map(([id, context]) => [id, context.provider, context.project.displayName]), [['voice-1', 'claude', 'life']]);
  assert.deepEqual(view.workspace.opened, ['voice-1']);
  assert.equal(controller.voiceSessionIds.has('voice-1'), true);
  assert.equal(controller.voiceSessionIds.has('old-voice'), true);
  assert.equal(controller.running, true);
  assert.equal(controller.mode, 'gemini');
});

test("Claude's first message is the voice session intro, sent before anything else, and the first request waits for its reply", async () => {
  const submitted: string[] = [];
  const view = mount(chat('s1', 'Bikes', submitted));
  await startVoice(view, submitted);
  const first = wsSends()[0];
  assert.equal(first.type, 'chat.send');
  assert.equal(first.sessionId, 'voice-1');
  assert.match(first.content, /^\[voice\] This is a voice session\./);
  assert.match(first.content, /1 to 4 short plain sentences/);
  assert.match(first.content, /Wait for his requests/);

  // A request arrives while Claude is still answering the intro: it waits, then goes out.
  let answer!: Promise<string>;
  act(() => { answer = live.gemini!.askClaude('what is in src'); });
  await flush();
  assert.equal(wsSends().length, 1);
  frame({ kind: 'text', sessionId: 'voice-1', role: 'assistant', content: 'Ready.', id: 'r1' });
  frame({ kind: 'complete', sessionId: 'voice-1', success: true });
  await waitFor(() => assert.equal(wsSends().length, 2));
  assert.equal(wsSends()[1].content, '[voice] what is in src');
  frame({ kind: 'text', sessionId: 'voice-1', role: 'assistant', content: 'Three files.', id: 'r2' });
  frame({ kind: 'complete', sessionId: 'voice-1', success: true });
  assert.equal(await answer, 'Three files.');
});

test('ask_claude goes to the voice session even when another session is on screen, and a switch does not stop the voice', async () => {
  const submitted: string[] = [];
  const view = mount(chat('s1', 'Bikes', submitted));
  await startVoice(view, submitted);
  frame({ kind: 'text', sessionId: 'voice-1', role: 'assistant', content: 'Ready.', id: 'r1' });
  frame({ kind: 'complete', sessionId: 'voice-1', success: true });
  const runBefore = live.runIds.at(-1);

  view.switchTo(chat('s2', 'Back pain', submitted, 'health'));
  assert.equal(controller.running, true);
  assert.equal(live.runIds.at(-1), runBefore);

  let answer!: Promise<string>;
  act(() => { answer = live.gemini!.askClaude('read the plan'); });
  await waitFor(() => assert.equal(wsSends().length, 2));
  assert.deepEqual(submitted, []);
  assert.equal(wsSends()[1].sessionId, 'voice-1');
  assert.equal(wsSends()[1].content, '[voice] read the plan');
  frame({ kind: 'text', sessionId: 's2', role: 'assistant', content: 'Wrong session.', id: 'x' });
  frame({ kind: 'complete', sessionId: 's2', success: true });
  frame({ kind: 'text', sessionId: 'voice-1', role: 'assistant', content: 'The plan is short.', id: 'r2' });
  frame({ kind: 'complete', sessionId: 'voice-1', success: true });
  assert.equal(await answer, 'The plan is short.');
});

test('with the voice session on screen the request goes through its composer', async () => {
  const submitted: string[] = [];
  const view = mount(chat('s1', 'Bikes', submitted));
  await startVoice(view, submitted);
  frame({ kind: 'text', sessionId: 'voice-1', role: 'assistant', content: 'Ready.', id: 'r1' });
  frame({ kind: 'complete', sessionId: 'voice-1', success: true });
  view.switchTo(chat('voice-1', 'Voice', submitted));
  void live.gemini!.askClaude('go').catch(() => undefined);
  await waitFor(() => assert.deepEqual(submitted, ['voice-1:[voice] go']));
});

test('only one live voice at a time: a second voice session ends the first and reconnects', async () => {
  const submitted: string[] = [];
  const view = mount(chat('s1', 'Bikes', submitted));
  await startVoice(view, submitted);
  const first = live.gemini!;
  const waiting = first.askClaude('first request');
  const outcome = assert.rejects(waiting, /voice session ended|did not start/);
  const runBefore = live.runIds.at(-1)!;

  act(() => controller.startVoiceSession(PROJECT));
  await waitFor(() => assert.equal(controller.voiceSession?.sessionId, 'voice-2'));
  assert.ok(live.runIds.at(-1)! > runBefore);
  assert.equal(controller.voiceSession?.sessionId, 'voice-2');
  await outcome;
  assert.equal(live.geminiActive.at(-1), true);
  // Requests now go to the second session.
  void live.gemini!.askClaude('second request').catch(() => undefined);
  frame({ kind: 'text', sessionId: 'voice-2', role: 'assistant', content: 'Ready.', id: 'r1' });
  frame({ kind: 'complete', sessionId: 'voice-2', success: true });
  await waitFor(() => assert.equal(wsSends().at(-1)?.sessionId, 'voice-2'));
});

test('everything said is saved under the voice session id, and what was said before the id arrived is not lost', async () => {
  const submitted: string[] = [];
  const view = mount(chat('s1', 'Bikes', submitted));
  act(() => controller.startVoiceSession(PROJECT));
  // Spoken before the server handed out the id.
  act(() => live.gemini!.onTranscript('user', 'hello there', 1_000));
  await waitFor(() => assert.ok(controller.voiceSession?.sessionId));
  act(() => live.gemini!.onTranscript('gemini', 'Hi Jason.', 2_000));
  await waitFor(() => assert.equal(saved['voice-1']?.length, 2));
  assert.deepEqual(saved['voice-1'].map((entry) => [entry.role, entry.text, entry.at]), [['user', 'hello there', 1_000], ['gemini', 'Hi Jason.', 2_000]]);
  assert.deepEqual(voiceTranscriptStore.get('voice-1').map((entry) => entry.text), ['hello there', 'Hi Jason.']);
  void view;
});

test('a failed start ends visibly, with the reason', async () => {
  const submitted: string[] = [];
  mount(chat('s1', 'Bikes', submitted));
  failRegister = true;
  act(() => controller.startVoiceSession(PROJECT));
  await waitFor(() => assert.equal(controller.running, false));
  assert.match(controller.endedNote ?? '', /Could not mark the session as a voice session/);
});

test('Gemini Live from its composer button attaches to the session on screen, marks it, and recaps the saved turns on connect', async () => {
  const submitted: string[] = [];
  mount(chat('s1', 'Bikes', submitted));
  voiceTranscriptStore.append('s1', { id: 'a', role: 'user', text: 'Open the plan', at: 1 });
  voiceTranscriptStore.append('s1', { id: 'b', role: 'gemini', text: 'On it.', at: 2 });
  act(() => controller.select('gemini'));
  assert.equal(controller.running, true);
  assert.equal(controller.voiceSession?.sessionId, 's1');
  await waitFor(() => assert.ok(calls.some((call) => call.url === '/api/voice/sessions/s1' && call.method === 'PUT')));
  assert.equal(wsSends().length, 0, 'an existing session gets no intro message');
  const recap = await live.gemini!.getRecap();
  assert.match(recap ?? '', /Jason: Open the plan\nYou: On it\./);
  assert.match(recap ?? '', /Do not repeat them/);
});

test('a session with nothing said yet has no recap', async () => {
  const submitted: string[] = [];
  mount(chat('s2', 'Back pain', submitted, 'health'));
  act(() => controller.select('gemini'));
  assert.equal(await live.gemini!.getRecap(), null);
});

test('Gemini Live has nothing to attach to in a chat with no session yet', async () => {
  const submitted: string[] = [];
  mount(chat(null, null, submitted));
  assert.equal(controller.geminiNeedsSession, true);
  act(() => controller.select('gemini'));
  assert.equal(controller.running, false);
});

test('the pill follows a rename of the voice session in the sidebar, and goes back to it', async () => {
  const submitted: string[] = [];
  const workspace: Workspace = { opened: [], established: [], sessions: SIDEBAR };
  const view = mount(chat('s1', 'Bikes', submitted), workspace);
  await startVoice(view, submitted);
  assert.match(controller.voiceSession?.name ?? '', /^Voice,/);
  workspace.sessions = [...SIDEBAR, { id: 'voice-1', name: 'Fix the bike gears', projectName: 'life' }];
  view.switchTo(chat('s1', 'Bikes', submitted));
  workspace.opened.length = 0;
  // The workspace registers a new directory object whenever its sessions change.
  view.unmountChat();
  view.switchTo(chat('s1', 'Bikes', submitted));
  await waitFor(() => assert.equal(controller.voiceSession?.name, 'Fix the bike gears'));
  act(() => controller.openVoiceSession());
  assert.deepEqual(workspace.opened.slice(-1), ['voice-1']);
});

test('a running session stays running, and is not reconnected, when another session with a different saved mode opens', async () => {
  const submitted: string[] = [];
  stored.s2 = { mode: 'gemini', geminiVoice: null };
  const view = mount(chat('s1', 'Bikes', submitted));
  act(() => controller.select('gemini'));
  assert.equal(controller.running, true);
  const activeBefore = live.geminiActive.length;

  view.switchTo(chat('s2', 'Back pain', submitted));
  await waitFor(() => assert.equal(stored.s2 !== undefined, true));
  assert.equal(controller.running, true);
  assert.equal(controller.mode, 'gemini');
  assert.ok(live.geminiActive.slice(activeBefore).every(Boolean), 'gemini stayed active through the switch');
});

test('the voice survives the chat unmounting, such as on the Files or Shell tab', async () => {
  const submitted: string[] = [];
  const view = mount(chat('s1', 'Bikes', submitted));
  act(() => controller.select('gemini'));
  view.unmountChat();
  assert.equal(live.geminiActive.at(-1), true);
  view.switchTo(chat('s2', 'Back pain', submitted));
  assert.equal(controller.running, true);
});

test('running goes false, with the reason, when the connection ends by itself', async () => {
  const submitted: string[] = [];
  mount(chat('s1', 'Bikes', submitted));
  act(() => controller.select('gemini'));
  assert.equal(controller.running, true);
  act(() => live.onEnded?.('The Gemini connection dropped.'));
  assert.equal(controller.running, false);
  assert.equal(controller.endedNote, 'The Gemini connection dropped.');
  assert.equal(controller.snapshot, null);
  assert.equal(controller.voiceSession, null);
});

test('running is never true when Gemini was picked but the server cannot offer it', async () => {
  live.status = { ...live.status, configured: false, reason: 'No key.' };
  const submitted: string[] = [];
  mount(chat('s1', 'Bikes', submitted));
  act(() => controller.select('gemini'));
  await waitFor(() => assert.equal(controller.running, false));
  assert.equal(controller.endedNote, 'No key.');
});

test('ending the voice from any session ends it everywhere and fails waiting requests', async () => {
  const submitted: string[] = [];
  const view = mount(chat('s1', 'Bikes', submitted));
  await startVoice(view, submitted);
  frame({ kind: 'text', sessionId: 'voice-1', role: 'assistant', content: 'Ready.', id: 'r1' });
  frame({ kind: 'complete', sessionId: 'voice-1', success: true });
  let waiting!: Promise<string>;
  act(() => { waiting = live.gemini!.askClaude('draft'); });
  await waitFor(() => assert.equal(wsSends().length, 2));
  const outcome = assert.rejects(waiting, /voice session ended/);
  view.switchTo(chat('s2', 'Back pain', submitted));
  act(() => controller.stop());
  assert.equal(controller.running, false);
  await outcome;
});

test('nothing starts by itself', async () => {
  const submitted: string[] = [];
  mount(chat('s1', 'Bikes', submitted));
  assert.equal(controller.running, false);
  assert.equal(live.geminiActive.every((active) => !active), true);
});
