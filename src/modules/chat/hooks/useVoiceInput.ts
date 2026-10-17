import { useCallback, useEffect, useRef, useState } from 'react';

import {
  applyDictationEvent,
  buildDictationUrl,
  chooseDictationMode,
  classifyStreamFailure,
  createDictationText,
  createPcmFramer,
  DICTATION_FINAL_TIMEOUT_MS,
  DICTATION_READY_TIMEOUT_MS,
} from '@/modules/chat/utils/liveDictation';
import type { DictationTextEvent, DictationTextState, PcmFramer } from '@/modules/chat/utils/liveDictation';
import { voicePlayer } from '@/modules/chat/utils/voicePlayer';
import { transcribeVoice } from '@/shared/api';
import { getStoredAuthToken } from '@/shared/authToken';
import type { DictationBox, VoiceInputState } from '@/shared/types';
import { IS_PLATFORM } from '@/shared/utils';
import { readVoiceConfig } from '@/shared/voiceConfig';

// Mobile-safe recording: iOS Safari 18.4+ supports webm/opus; older iOS needs mp4.
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function pickMime(): string {
  for (const t of MIME_CANDIDATES) {
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* isTypeSupported can throw on some iOS versions */
    }
  }
  return '';
}

// The worklet batches 2048 samples per message (about 43 ms at 48 kHz) so the audio thread posts ~23 times a second.
// A 'flush' message sends the remainder when the mic stops.
const WORKLET_NAME = 'dictation-capture';
const WORKLET_SOURCE = `
class DictationCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.filled = 0;
    this.port.onmessage = () => this.flush();
  }
  flush() {
    if (this.filled > 0) {
      this.port.postMessage(this.buffer.slice(0, this.filled));
      this.filled = 0;
    }
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i];
        if (this.filled === this.buffer.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', DictationCapture);
`;

/** Everything one live dictation attempt owns, so a failure or unmount can release all of it in one place. */
type LiveSession = {
  ctx: AudioContext;
  ws: WebSocket | null;
  node: AudioWorkletNode | null;
  source: MediaStreamAudioSourceNode | null;
  framer: PcmFramer | null;
  text: DictationTextState | null;
  /** Frames captured before the server's `ready`, sent in order once it arrives. */
  queue: ArrayBuffer[];
  ready: boolean;
  endRequested: boolean;
  endSent: boolean;
  failed: boolean;
  finalText: string | null;
  readyTimer: ReturnType<typeof setTimeout> | null;
  /** Wakes the stop handler that is waiting for `final` or a failure. */
  settle: (() => void) | null;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Dictation into the message box. With a message box and a browser that can stream, the mic is also sent as 24 kHz
 * mono s16 frames to /api/voice/dictate and the words appear in the box as they are spoken. The mic is always
 * recorded as well, so if streaming fails at any point the whole recording goes through the record-then-upload path
 * (/api/voice/transcribe) and no speech is lost. Without a box, or when streaming is unavailable, it is that
 * upload path alone, returning the transcript through onTranscript.
 */
export function useVoiceInput(
  onTranscript: (text: string, send?: boolean) => void,
  onError?: (msg: string) => void,
  box?: DictationBox,
) {
  const [state, setState] = useState<VoiceInputState>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const startingRef = useRef(false);
  // Whether the in-progress stop should auto-send the transcript (vs just fill the box).
  const sendRef = useRef(false);
  const liveRef = useRef<LiveSession | null>(null);
  // Set when the speech server or this app's config rules streaming out; the next taps go straight to upload.
  const streamingDisabledRef = useRef(false);
  // The recorder's onstop outlives the render that created it, so it reads the latest props from refs.
  const boxRef = useRef(box);
  const onErrorRef = useRef(onError);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    boxRef.current = box;
    onErrorRef.current = onError;
    onTranscriptRef.current = onTranscript;
  });

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const teardownLive = useCallback((session: LiveSession | null) => {
    if (!session) return;
    if (session.readyTimer) clearTimeout(session.readyTimer);
    session.readyTimer = null;
    if (session.node) {
      session.node.port.onmessage = null;
      session.node.disconnect();
    }
    session.source?.disconnect();
    if (session.ws) {
      session.ws.onmessage = null;
      session.ws.onclose = null;
      session.ws.onerror = null;
      if (session.ws.readyState === WebSocket.OPEN || session.ws.readyState === WebSocket.CONNECTING) {
        session.ws.close();
      }
    }
    void session.ctx.close().catch(() => undefined);
    if (liveRef.current === session) liveRef.current = null;
  }, []);

  // Stop the mic if the component unmounts mid-recording.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      startingRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      teardownLive(liveRef.current);
    };
  }, [teardownLive]);

  /** Runs one socket event through the reducer and into the message box. */
  const applyToBox = useCallback((session: LiveSession, event: DictationTextEvent) => {
    const target = boxRef.current;
    if (!target || !session.text) return;
    const result = applyDictationEvent(session.text, event, target.read());
    session.text = result.state;
    if (result.box !== target.read()) target.write(result.box);
  }, []);

  /** Ends the live attempt without a transcript. The recording is uploaded instead. */
  const failLive = useCallback((session: LiveSession, reason: { serverMessage?: string; closeCode?: number; timedOut?: boolean }) => {
    if (session.failed || session.finalText !== null) return;
    session.failed = true;
    applyToBox(session, { kind: 'discard' });
    const failure = classifyStreamFailure(reason);
    if (failure.disableStreaming) streamingDisabledRef.current = true;
    onErrorRef.current?.(failure.notice);
    teardownLive(session);
    session.settle?.();
  }, [applyToBox, teardownLive]);

  const sendFrame = useCallback((session: LiveSession, frame: Int16Array) => {
    const bytes = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer;
    if (session.ready && session.ws?.readyState === WebSocket.OPEN) session.ws.send(bytes);
    else session.queue.push(bytes);
  }, []);

  /** Sends queued audio and, once the stop was tapped, the `end` frame. Safe to call repeatedly. */
  const pumpLive = useCallback((session: LiveSession) => {
    const ws = session.ws;
    if (session.failed || !session.ready || !ws || ws.readyState !== WebSocket.OPEN) return;
    for (const bytes of session.queue.splice(0)) ws.send(bytes);
    if (session.endRequested && !session.endSent) {
      session.endSent = true;
      ws.send(JSON.stringify({ type: 'end' }));
    }
  }, []);

  const beginLive = useCallback(async (session: LiveSession, stream: MediaStream) => {
    try {
      const ws = new WebSocket(buildDictationUrl(window.location, IS_PLATFORM ? null : getStoredAuthToken(), readVoiceConfig().apiKey));
      ws.binaryType = 'arraybuffer';
      session.ws = ws;
      session.readyTimer = setTimeout(() => failLive(session, { timedOut: true }), DICTATION_READY_TIMEOUT_MS);

      ws.onmessage = (message) => {
        if (typeof message.data !== 'string') return;
        let event: { type?: string; tag?: string; text?: string; message?: string };
        try {
          event = JSON.parse(message.data);
        } catch {
          return;
        }
        if (event.type === 'ready') {
          if (session.readyTimer) clearTimeout(session.readyTimer);
          session.readyTimer = null;
          session.ready = true;
          session.text = createDictationText(typeof event.tag === 'string' ? event.tag : '');
          pumpLive(session);
        } else if (event.type === 'delta' && typeof event.text === 'string') {
          applyToBox(session, { kind: 'delta', text: event.text });
        } else if (event.type === 'final') {
          session.finalText = typeof event.text === 'string' ? event.text : '';
          session.settle?.();
        } else if (event.type === 'error') {
          failLive(session, { serverMessage: event.message });
        }
      };
      ws.onclose = (event) => {
        if (session.finalText === null) failLive(session, { closeCode: event.code });
      };

      const blobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      try {
        await session.ctx.audioWorklet.addModule(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
      if (session.failed || liveRef.current !== session) return;
      if (session.ctx.state === 'suspended') await session.ctx.resume().catch(() => undefined);

      const framer = createPcmFramer(session.ctx.sampleRate);
      session.framer = framer;
      const source = session.ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(session.ctx, WORKLET_NAME, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      // Safari only pulls a worklet that reaches the destination, so it goes through a muted gain.
      const mute = session.ctx.createGain();
      mute.gain.value = 0;
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        for (const frame of framer.push(event.data)) sendFrame(session, frame);
      };
      source.connect(node);
      node.connect(mute);
      mute.connect(session.ctx.destination);
      session.source = source;
      session.node = node;
    } catch {
      failLive(session, {});
    }
  }, [failLive, applyToBox, pumpLive, sendFrame]);

  /** After the mic stops: flush the last audio, send `end`, and wait up to 12 s for `final`. Returns the final text, or null when the upload path should run. */
  const finishLive = useCallback(async (session: LiveSession): Promise<string | null> => {
    session.endRequested = true;
    session.node?.port.postMessage('flush');
    // Let the worklet's last batch cross the message port before the framer is flushed.
    await sleep(60);
    const rest = session.framer?.flush();
    if (rest) sendFrame(session, rest);
    pumpLive(session);

    if (!session.failed && session.finalText === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          failLive(session, { timedOut: true });
          resolve();
        }, DICTATION_FINAL_TIMEOUT_MS);
        session.settle = () => {
          clearTimeout(timer);
          resolve();
        };
        // `final` may have landed during the 60 ms wait.
        if (session.failed || session.finalText !== null) session.settle();
      });
    }
    return session.failed ? null : session.finalText;
  }, [failLive, pumpLive, sendFrame]);

  const uploadRecording = useCallback(async (blob: Blob, type: string, shouldSend: boolean) => {
    if (blob.size < 800) {
      setState('idle');
      onErrorRef.current?.('Recording too short');
      return;
    }
    setState('transcribing');
    try {
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const res = await transcribeVoice(blob, `recording.${ext}`);
      if (!res.ok) throw new Error(`transcribe ${res.status}`);
      const data = await res.json();
      if (cancelledRef.current) return;
      const text = String(data?.text || '').trim();
      if (text) onTranscriptRef.current(text, shouldSend);
      else onErrorRef.current?.('No speech detected');
    } catch (e) {
      if (!cancelledRef.current) {
        onErrorRef.current?.(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (!cancelledRef.current) setState('idle');
    }
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current || (recorderRef.current && recorderRef.current.state !== 'inactive')) return;
    // Still inside the mic tap: unlock audio so the reply can be spoken later without a tap
    // (iOS), and stop any reply that's playing, since talking over it means "I've heard enough".
    voicePlayer.unlock();
    voicePlayer.stop();
    startingRef.current = true;

    // The AudioContext is created and resumed here, synchronously inside the tap, before any await.
    // iOS Safari leaves a context created later in "suspended" and never delivers audio to it.
    let ctx: AudioContext | null = null;
    const mode = chooseDictationMode({
      hasMessageBox: Boolean(boxRef.current),
      hasWebSocket: typeof WebSocket !== 'undefined',
      hasAudioContext: typeof AudioContext !== 'undefined',
      hasAudioWorklet: typeof AudioWorkletNode !== 'undefined' && typeof AudioContext !== 'undefined'
        && Boolean(AudioContext.prototype && 'audioWorklet' in AudioContext.prototype),
      customVoiceBaseUrl: Boolean(readVoiceConfig().baseUrl.trim()),
      streamingDisabled: streamingDisabledRef.current,
    });
    if (mode === 'stream') {
      try {
        ctx = new AudioContext();
        void ctx.resume().catch(() => undefined);
      } catch {
        ctx = null;
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        void ctx?.close().catch(() => undefined);
        return;
      }
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      rec.onstop = async () => {
        stopTracks();
        const session = liveRef.current;
        if (cancelledRef.current) {
          teardownLive(session);
          return;
        }
        // Capture and clear the send intent for this stop before any async work.
        const shouldSend = sendRef.current;
        sendRef.current = false;
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });

        if (session) {
          setState('transcribing');
          const finalText = await finishLive(session);
          const target = boxRef.current;
          teardownLive(session);
          if (cancelledRef.current) return;
          if (finalText !== null && target) {
            // `final` is authoritative: it replaces the interim words, marker included.
            if (finalText.trim()) {
              applyToBox(session, { kind: 'final', text: finalText });
              if (shouldSend) target.submit();
            } else {
              applyToBox(session, { kind: 'discard' });
              onErrorRef.current?.('No speech detected');
            }
            setState('idle');
            return;
          }
          // The stream failed or timed out. failLive already removed the interim text and showed the notice.
        }
        await uploadRecording(blob, type, shouldSend);
      };

      rec.start();
      setState('recording');

      if (ctx) {
        const session: LiveSession = {
          ctx,
          ws: null,
          node: null,
          source: null,
          framer: null,
          text: null,
          queue: [],
          ready: false,
          endRequested: false,
          endSent: false,
          failed: false,
          finalText: null,
          readyTimer: null,
          settle: null,
        };
        liveRef.current = session;
        ctx = null;
        void beginLive(session, stream);
      }
    } catch (e) {
      recorderRef.current = null;
      stopTracks();
      void ctx?.close().catch(() => undefined);
      if (cancelledRef.current) return;
      const err = e as { name?: string; message?: string };
      let msg = `Mic error: ${err?.message || e}`;
      if (err?.name === 'NotAllowedError') msg = 'Microphone access denied.';
      else if (err?.name === 'NotFoundError') msg = 'No microphone found.';
      onErrorRef.current?.(msg);
      setState('idle');
    } finally {
      startingRef.current = false;
    }
  }, [teardownLive, beginLive, finishLive, uploadRecording, applyToBox]);

  // Stop recording. Pass { send: true } to auto-send the transcript once it's ready.
  // Guard on the recorder's own state (not React state) so a double tap, or the mic
  // and Send buttons both firing, can't call stop() on an already-inactive recorder.
  const stop = useCallback((opts?: { send?: boolean }) => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      sendRef.current = opts?.send ?? false;
      rec.stop();
    }
  }, []);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') start();
  }, [state, start, stop]);

  return { state, toggle, stop };
}
