import { floatToPcm16 } from '@/modules/chat/utils/pcmAudio';

/** Sample rate the speech server's streaming endpoint expects. */
export const DICTATION_SAMPLE_RATE = 24000;

/** One binary frame carries about this much audio. */
export const DICTATION_FRAME_MS = 100;

/** How long the stop tap waits for the server's `final` before the recorded audio is uploaded instead. */
export const DICTATION_FINAL_TIMEOUT_MS = 12000;

/** How long the socket gets to deliver `ready` before streaming is abandoned. */
export const DICTATION_READY_TIMEOUT_MS = 6000;

//----------------- DOWNSAMPLING AND FRAMING ------------

/** Used by useVoiceInput to turn raw mic blocks into 24 kHz mono s16 frames. */
export type PcmFramer = {
  /** Feeds mic samples at the native rate and returns every complete frame they finish. */
  push: (samples: Float32Array) => Int16Array[];
  /** Returns the partial frame still held, or null when there is none. Call once when the mic stops. */
  flush: () => Int16Array | null;
};

/**
 * Linear-interpolating resampler plus fixed-size framer. It keeps its read
 * position and the last input sample between pushes, so block boundaries (128
 * samples from an AudioWorklet) leave no gaps or clicks at any native rate
 * (44.1 kHz, 48 kHz, or already 24 kHz).
 */
export function createPcmFramer(
  inputRate: number,
  outputRate = DICTATION_SAMPLE_RATE,
  frameMs = DICTATION_FRAME_MS,
): PcmFramer {
  const frameSamples = Math.round((outputRate * frameMs) / 1000);
  const step = inputRate / outputRate;
  // Output sample k sits at input position k * step. `position` is relative to `carry`, whose first element is the
  // last input sample of the previous push, so interpolation across a block boundary has both neighbours.
  let carry: Float32Array = new Float32Array(0);
  let position = 0;
  let pending: number[] = [];

  const drainFrames = (): Int16Array[] => {
    const frames: Int16Array[] = [];
    while (pending.length >= frameSamples) {
      frames.push(floatToPcm16(Float32Array.from(pending.slice(0, frameSamples))));
      pending = pending.slice(frameSamples);
    }
    return frames;
  };

  return {
    push(samples) {
      if (samples.length === 0) return [];
      const input = new Float32Array(carry.length + samples.length);
      input.set(carry);
      input.set(samples, carry.length);
      while (position + 1 < input.length) {
        const index = Math.floor(position);
        const fraction = position - index;
        pending.push(input[index] * (1 - fraction) + input[index + 1] * fraction);
        position += step;
      }
      // Keep the sample the next output position still needs.
      const keepFrom = Math.floor(position);
      carry = input.slice(keepFrom);
      position -= keepFrom;
      return drainFrames();
    },
    flush() {
      if (pending.length === 0) return null;
      const rest = floatToPcm16(Float32Array.from(pending));
      pending = [];
      return rest;
    },
  };
}

//----------------- LIVE TEXT IN THE MESSAGE BOX ------------

/**
 * Tracks the dictated text living at the end of the message box. `segment` is the exact string this reducer last
 * appended (joiner included), `written` the whole box value it produced. Comparing both with the box on the next
 * event is how a user edit made while dictating is detected.
 */
export type DictationTextState = {
  /** The speech server's marker ("[voice] "), shown in front of the dictated words and kept in the final text. */
  tag: string;
  /** Words recognised so far (or the authoritative text once `final` arrives). */
  heard: string;
  segment: string;
  written: string;
  /** True once the user edited inside the dictated text, which turns it into their own text. */
  frozen: boolean;
};

/** Events the live dictation socket produces. `discard` removes the interim text before a fallback upload. */
export type DictationTextEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'final'; text: string }
  | { kind: 'discard' };

/** Starts tracking with the marker from the server's `ready` frame. */
export function createDictationText(tag: string): DictationTextState {
  return { tag, heard: '', segment: '', written: '', frozen: false };
}

function joinerFor(prefix: string): string {
  return prefix.length === 0 || /\s$/.test(prefix) ? '' : ' ';
}

/**
 * Applies one socket event to the message box and returns the new box value.
 * - `delta` appends words after whatever is in the box (marker first).
 * - `final` replaces everything dictated so far with the authoritative text.
 * - If the user typed before the dictated text, their edit stays and the dictated text keeps following it.
 * - If the user edited inside or after the dictated text, that text becomes theirs. Later deltas start a fresh
 *   unmarked segment after it and `final` only replaces that fresh segment.
 */
export function applyDictationEvent(
  state: DictationTextState,
  event: DictationTextEvent,
  box: string,
): { state: DictationTextState; box: string } {
  let { tag, heard, frozen } = state;
  let prefix = box;
  if (state.segment) {
    if (box.endsWith(state.segment)) {
      prefix = box.slice(0, box.length - state.segment.length);
    } else {
      // Edited inside or after our text: freeze it in place and start over after it.
      frozen = true;
      tag = '';
      heard = '';
    }
  }

  if (event.kind === 'delta') heard += event.text;
  else if (event.kind === 'final') heard = frozen ? heard : event.text;
  else heard = '';

  const words = heard.trim();
  const display = words ? `${tag}${words}` : '';
  const segment = display ? `${joinerFor(prefix)}${display}` : '';
  const next = prefix + segment;
  return { state: { tag, heard, segment, written: next, frozen }, box: next };
}

//----------------- CHOOSING STREAM OR UPLOAD ------------

/** What the browser and settings offer, read once per mic tap. */
export type DictationEnvironment = {
  hasMessageBox: boolean;
  hasWebSocket: boolean;
  hasAudioContext: boolean;
  hasAudioWorklet: boolean;
  /** The user pointed dictation at their own speech endpoint, which the server-side stream route does not reach. */
  customVoiceBaseUrl: boolean;
  /** An earlier stream said live dictation is not available on this speech server. */
  streamingDisabled: boolean;
};

/** Picks the live stream when everything it needs exists, otherwise the record-then-upload path. */
export function chooseDictationMode(environment: DictationEnvironment): 'stream' | 'upload' {
  const { hasMessageBox, hasWebSocket, hasAudioContext, hasAudioWorklet, customVoiceBaseUrl, streamingDisabled } = environment;
  return hasMessageBox && hasWebSocket && hasAudioContext && hasAudioWorklet && !customVoiceBaseUrl && !streamingDisabled
    ? 'stream'
    : 'upload';
}

/** What the hook does after a stream stops working. */
export type StreamFailure = {
  /** One-line notice shown to the user. */
  notice: string;
  /** Skip the stream for the rest of the page session, because retrying cannot help. */
  disableStreaming: boolean;
};

/**
 * Classifies why a stream ended without a `final`. The recorded audio is always uploaded afterwards, so this only
 * decides the notice and whether the next tap should try the stream again.
 */
export function classifyStreamFailure(reason: { serverMessage?: string; closeCode?: number; timedOut?: boolean }): StreamFailure {
  const notice = 'Live dictation unavailable, transcribing after you stop.';
  const message = reason.serverMessage?.toLowerCase() ?? '';
  const needsOtherBackend = message.includes('needs the openai');
  // 4503: no speech backend configured on the mini-ADE server. 4401: the speech server refused the key.
  const permanent = needsOtherBackend || reason.closeCode === 4503 || reason.closeCode === 4401;
  return { notice, disableStreaming: permanent };
}

/** Builds the dictation socket URL on the page's own host, so the browser never talks to the speech server. */
export function buildDictationUrl(location: { protocol: string; host: string }, token: string | null, voiceKey: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  if (voiceKey) params.set('voice_key', voiceKey);
  const query = params.toString();
  return `${protocol}//${location.host}/api/voice/dictate${query ? `?${query}` : ''}`;
}
