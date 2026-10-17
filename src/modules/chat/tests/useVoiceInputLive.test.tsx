import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useVoiceInput } from '@/modules/chat/hooks/useVoiceInput';
import type { DictationBox } from '@/shared/types';

const transcribeVoice = vi.fn();
vi.mock('@/shared/api', () => ({ transcribeVoice: (...args: unknown[]) => transcribeVoice(...args) }));
vi.mock('@/modules/chat/utils/voicePlayer', () => ({ voicePlayer: { unlock: () => undefined, stop: () => undefined } }));

/**
 * Drives the real hook against fake browser audio and socket APIs: the live path types into the box as words
 * arrive, and every failure falls back to uploading the recording that ran alongside.
 */

class FakeSocket {
  static instances: FakeSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  readyState = 1;
  binaryType = '';
  sent: Array<ArrayBuffer | string> = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: ArrayBuffer | string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  serverSays(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

class FakeNode {
  static last: FakeNode | null = null;
  port: { onmessage: ((event: { data: Float32Array }) => void) | null; postMessage: (message: unknown) => void } = {
    onmessage: null,
    postMessage: () => undefined,
  };
  constructor() {
    FakeNode.last = this;
  }
  connect() {}
  disconnect() {}
}

class FakeAudioContext {
  sampleRate = 48000;
  state = 'running';
  destination = {};
  get audioWorklet() {
    return { addModule: async () => undefined };
  }
  resume = async () => undefined;
  close = async () => undefined;
  createMediaStreamSource = () => ({ connect() {}, disconnect() {} });
  createGain = () => ({ gain: { value: 1 }, connect() {} });
}

class FakeRecorder {
  static isTypeSupported = () => true;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(4000)]) });
  }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => this.onstop?.());
  }
}

function makeBox(initial = '') {
  let value = initial;
  const submit = vi.fn();
  const box: DictationBox = { read: () => value, write: (next) => { value = next; }, submit };
  return { box, value: () => value, submit };
}

async function openStream(result: { current: ReturnType<typeof useVoiceInput> }) {
  await act(async () => {
    result.current.toggle();
  });
  await waitFor(() => expect(FakeNode.last?.port.onmessage).toBeTruthy());
  return FakeSocket.instances[FakeSocket.instances.length - 1];
}

describe('useVoiceInput live dictation', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    FakeNode.last = null;
    transcribeVoice.mockReset();
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', FakeNode);
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] }) },
    });
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('types words into the box as they arrive and replaces them with the final text, without uploading', async () => {
    const target = makeBox('note:');
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput(onTranscript, vi.fn(), target.box));
    const socket = await openStream(result);
    expect(socket.url).toContain('/api/voice/dictate');

    // Audio captured before `ready` is queued, then sent in order once the server is ready.
    FakeNode.last!.port.onmessage!({ data: new Float32Array(9600) });
    expect(socket.sent).toHaveLength(0);
    act(() => socket.serverSays({ type: 'ready', tag: '[voice] ' }));
    expect(socket.sent.length).toBeGreaterThan(0);
    expect(socket.sent[0]).toBeInstanceOf(ArrayBuffer);

    act(() => socket.serverSays({ type: 'delta', text: ' helo' }));
    expect(target.value()).toBe('note: [voice] helo');
    act(() => socket.serverSays({ type: 'delta', text: ' wrld' }));
    expect(target.value()).toBe('note: [voice] helo wrld');

    await act(async () => {
      result.current.toggle();
    });
    await waitFor(() => expect(socket.sent).toContain('{"type":"end"}'));
    act(() => socket.serverSays({ type: 'final', text: 'Hello world.' }));
    await waitFor(() => expect(result.current.state).toBe('idle'));

    expect(target.value()).toBe('note: [voice] Hello world.');
    expect(transcribeVoice).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(target.submit).not.toHaveBeenCalled();
  });

  it('submits after the final text when stop was tapped with send', async () => {
    const target = makeBox();
    const { result } = renderHook(() => useVoiceInput(vi.fn(), vi.fn(), target.box));
    const socket = await openStream(result);
    act(() => socket.serverSays({ type: 'ready', tag: '[voice] ' }));
    await act(async () => {
      result.current.stop({ send: true });
    });
    await waitFor(() => expect(socket.sent).toContain('{"type":"end"}'));
    act(() => socket.serverSays({ type: 'final', text: 'Run the tests.' }));
    await waitFor(() => expect(target.submit).toHaveBeenCalledTimes(1));
    expect(target.value()).toBe('[voice] Run the tests.');
  });

  it('uploads the recording through the old path when the socket drops mid-way, removing the interim words', async () => {
    transcribeVoice.mockResolvedValue({ ok: true, json: async () => ({ text: '[voice] full sentence' }) });
    const target = makeBox();
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceInput(onTranscript, onError, target.box));
    const socket = await openStream(result);
    act(() => socket.serverSays({ type: 'ready', tag: '[voice] ' }));
    act(() => socket.serverSays({ type: 'delta', text: ' full' }));
    expect(target.value()).toBe('[voice] full');

    act(() => socket.onclose?.({ code: 1006 }));
    expect(target.value()).toBe('');
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Live dictation unavailable/));

    await act(async () => {
      result.current.toggle();
    });
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('[voice] full sentence', false));
    expect(transcribeVoice).toHaveBeenCalledTimes(1);
    expect((transcribeVoice.mock.calls[0][0] as Blob).size).toBe(4000);
  });

  it('falls back when the server says live dictation needs the OpenAI backend, and stops trying on the next tap', async () => {
    transcribeVoice.mockResolvedValue({ ok: true, json: async () => ({ text: 'ok' }) });
    const target = makeBox();
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput(onTranscript, vi.fn(), target.box));
    const socket = await openStream(result);
    act(() => socket.serverSays({ type: 'error', message: 'live dictation needs the OpenAI speech backend' }));
    await act(async () => {
      result.current.toggle();
    });
    await waitFor(() => expect(onTranscript).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.state).toBe('idle'));

    const socketsBefore = FakeSocket.instances.length;
    await act(async () => {
      result.current.toggle();
    });
    await waitFor(() => expect(result.current.state).toBe('recording'));
    expect(FakeSocket.instances.length).toBe(socketsBefore);
  });

  it('goes straight to the upload path without a message box', async () => {
    transcribeVoice.mockResolvedValue({ ok: true, json: async () => ({ text: 'plain' }) });
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput(onTranscript, vi.fn()));
    await act(async () => {
      result.current.toggle();
    });
    await waitFor(() => expect(result.current.state).toBe('recording'));
    await act(async () => {
      result.current.toggle();
    });
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('plain', false));
    expect(FakeSocket.instances).toHaveLength(0);
  });
});
