import { describe, expect, it } from 'vitest';

import {
  applyDictationEvent,
  buildDictationUrl,
  chooseDictationMode,
  classifyStreamFailure,
  createDictationText,
  createPcmFramer,
} from '@/modules/chat/utils/liveDictation';
import type { DictationEnvironment, DictationTextEvent } from '@/modules/chat/utils/liveDictation';

function sine(rate: number, seconds: number, hz = 440): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

function feed(rate: number, samples: Float32Array, block: number) {
  const framer = createPcmFramer(rate);
  const frames: Int16Array[] = [];
  for (let i = 0; i < samples.length; i += block) frames.push(...framer.push(samples.subarray(i, i + block)));
  return { frames, rest: framer.flush() };
}

describe('createPcmFramer', () => {
  it.each([48000, 44100, 24000])('turns one second at %i Hz into about ten 100 ms frames of 2400 samples', (rate) => {
    const { frames, rest } = feed(rate, sine(rate, 1), 2048);
    expect(frames.every((frame) => frame.length === 2400)).toBe(true);
    const total = frames.length * 2400 + (rest?.length ?? 0);
    expect(Math.abs(total - 24000)).toBeLessThanOrEqual(2);
    expect(frames.length).toBeGreaterThanOrEqual(9);
  });

  it('gives the same samples whatever the block size, so block edges leave no gaps', () => {
    const input = sine(44100, 0.5);
    const small = feed(44100, input, 128);
    const large = feed(44100, input, 4096);
    const flat = (r: ReturnType<typeof feed>) => [...r.frames, ...(r.rest ? [r.rest] : [])].flatMap((f) => [...f]);
    const a = flat(small);
    const b = flat(large);
    const n = Math.min(a.length, b.length);
    expect(n).toBeGreaterThan(11000);
    for (let i = 0; i < n; i++) expect(a[i]).toBe(b[i]);
  });

  it('preserves the tone: a 440 Hz sine stays a 440 Hz sine at 24 kHz', () => {
    const { frames } = feed(48000, sine(48000, 0.5), 2048);
    const flat = frames.flatMap((f) => [...f]);
    let crossings = 0;
    for (let i = 1; i < flat.length; i++) if (flat[i - 1] < 0 && flat[i] >= 0) crossings++;
    const seconds = flat.length / 24000;
    expect(crossings / seconds).toBeGreaterThan(430);
    expect(crossings / seconds).toBeLessThan(450);
  });

  it('clamps to signed 16 bit', () => {
    const framer = createPcmFramer(24000);
    const loud = new Float32Array(2500).fill(3);
    const [frame] = framer.push(loud);
    expect(Math.max(...frame)).toBe(32767);
    const quiet = new Float32Array(2500).fill(-3);
    const [low] = createPcmFramer(24000).push(quiet);
    expect(Math.min(...low)).toBe(-32768);
  });

  it('holds a partial frame until flush, then has nothing left', () => {
    const framer = createPcmFramer(24000);
    expect(framer.push(new Float32Array(1000))).toHaveLength(0);
    const rest = framer.flush();
    expect(rest?.length).toBeGreaterThan(900);
    expect(framer.flush()).toBeNull();
  });
});

describe('applyDictationEvent', () => {
  const run = (box: string, events: DictationTextEvent[], tag = '[voice] ') => {
    let state = createDictationText(tag);
    let value = box;
    for (const event of events) ({ state, box: value } = applyDictationEvent(state, event, value));
    return { state, box: value };
  };

  it('appends deltas into an empty box with the marker in front', () => {
    expect(run('', [{ kind: 'delta', text: ' hello' }, { kind: 'delta', text: ' there' }]).box).toBe('[voice] hello there');
  });

  it('shows nothing until the first word arrives', () => {
    expect(run('', [{ kind: 'delta', text: ' ' }]).box).toBe('');
  });

  it('appends after existing text with one space, and after trailing whitespace with none', () => {
    expect(run('fix the bug', [{ kind: 'delta', text: ' and' }]).box).toBe('fix the bug [voice] and');
    expect(run('fix the bug ', [{ kind: 'delta', text: ' and' }]).box).toBe('fix the bug [voice] and');
  });

  it('replaces the interim text with the final text, keeping the marker', () => {
    const result = run('note:', [
      { kind: 'delta', text: ' helo' },
      { kind: 'delta', text: ' wrld' },
      { kind: 'final', text: 'Hello world.' },
    ]);
    expect(result.box).toBe('note: [voice] Hello world.');
  });

  it('keeps an edit the user made before the dictated text and keeps following it', () => {
    let state = createDictationText('[voice] ');
    let box = 'ab';
    ({ state, box } = applyDictationEvent(state, { kind: 'delta', text: ' one' }, box));
    expect(box).toBe('ab [voice] one');
    box = 'XYZ ab [voice] one';
    ({ state, box } = applyDictationEvent(state, { kind: 'delta', text: ' two' }, box));
    expect(box).toBe('XYZ ab [voice] one two');
    ({ state, box } = applyDictationEvent(state, { kind: 'final', text: 'One two.' }, box));
    expect(box).toBe('XYZ ab [voice] One two.');
    expect(state.frozen).toBe(false);
  });

  it('treats an edit inside the dictated text as the user\'s own and does not overwrite it on final', () => {
    let state = createDictationText('[voice] ');
    let box = '';
    ({ state, box } = applyDictationEvent(state, { kind: 'delta', text: ' send the file' }, box));
    box = '[voice] send the files'; // user fixed a word inside it
    ({ state, box } = applyDictationEvent(state, { kind: 'delta', text: ' now' }, box));
    expect(box).toBe('[voice] send the files now');
    ({ state, box } = applyDictationEvent(state, { kind: 'final', text: 'Send the file now.' }, box));
    expect(box).toBe('[voice] send the files now');
    expect(state.frozen).toBe(true);
  });

  it('discard removes the interim text and leaves the rest of the box alone', () => {
    const result = run('keep this', [{ kind: 'delta', text: ' maybe' }, { kind: 'discard' }]);
    expect(result.box).toBe('keep this');
  });

  it('an empty final clears the interim text', () => {
    expect(run('hi', [{ kind: 'delta', text: ' um' }, { kind: 'final', text: '' }]).box).toBe('hi');
  });

  it('starts with the marker whenever the box was empty, which is what makes replies read aloud', () => {
    const { box } = run('', [{ kind: 'delta', text: ' hi' }, { kind: 'final', text: 'Hi.' }]);
    expect(box.trimStart().startsWith('[voice]')).toBe(true);
  });
});

describe('chooseDictationMode', () => {
  const full: DictationEnvironment = {
    hasMessageBox: true,
    hasWebSocket: true,
    hasAudioContext: true,
    hasAudioWorklet: true,
    customVoiceBaseUrl: false,
    streamingDisabled: false,
  };

  it('streams when everything is available', () => {
    expect(chooseDictationMode(full)).toBe('stream');
  });

  it.each([
    ['no message box', { hasMessageBox: false }],
    ['no WebSocket', { hasWebSocket: false }],
    ['no AudioContext', { hasAudioContext: false }],
    ['no AudioWorklet', { hasAudioWorklet: false }],
    ['a custom speech endpoint', { customVoiceBaseUrl: true }],
    ['streaming ruled out earlier this session', { streamingDisabled: true }],
  ])('uploads with %s', (_label, patch) => {
    expect(chooseDictationMode({ ...full, ...patch })).toBe('upload');
  });
});

describe('classifyStreamFailure', () => {
  it('rules streaming out for the session when the server needs the OpenAI backend', () => {
    const result = classifyStreamFailure({ serverMessage: 'live dictation needs the OpenAI speech backend' });
    expect(result.disableStreaming).toBe(true);
    expect(result.notice).toMatch(/after you stop/);
  });

  it.each([4503, 4401])('rules streaming out on close code %i', (closeCode) => {
    expect(classifyStreamFailure({ closeCode }).disableStreaming).toBe(true);
  });

  it('keeps streaming enabled after a transient failure', () => {
    expect(classifyStreamFailure({ closeCode: 1006 }).disableStreaming).toBe(false);
    expect(classifyStreamFailure({ timedOut: true }).disableStreaming).toBe(false);
    expect(classifyStreamFailure({ serverMessage: 'live transcription failed' }).disableStreaming).toBe(false);
  });
});

describe('buildDictationUrl', () => {
  it('uses wss on https and carries the token and voice key as encoded query parameters', () => {
    expect(buildDictationUrl({ protocol: 'https:', host: 'a.ts.net' }, 'tok en', 'k&1')).toBe(
      'wss://a.ts.net/api/voice/dictate?token=tok+en&voice_key=k%261',
    );
  });

  it('uses ws on http and omits empty parameters', () => {
    expect(buildDictationUrl({ protocol: 'http:', host: 'localhost:3001' }, null, '')).toBe('ws://localhost:3001/api/voice/dictate');
  });
});
