import { useCallback, useEffect, useRef, useState } from 'react';

import { runToolCalls } from '@/modules/chat/utils/askClaudeTool';
import { createGeminiAudioPlayer } from '@/modules/chat/utils/geminiAudioPlayer';
import type { GeminiAudioPlayer } from '@/modules/chat/utils/geminiAudioPlayer';
import {
  buildAudioMessage,
  buildContextMessage,
  buildLiveSocketUrl,
  buildSetupMessage,
  buildToolResponse,
  createResumptionTracker,
  GEMINI_INPUT_SAMPLE_RATE,
  GEMINI_OUTPUT_SAMPLE_RATE,
  parseServerMessage,
} from '@/modules/chat/utils/geminiLiveProtocol';
import type { GeminiServerEvent } from '@/modules/chat/utils/geminiLiveProtocol';
import { createIdleWatchdog, GEMINI_IDLE_TIMEOUT_MS } from '@/modules/chat/utils/idleWatchdog';
import { createLiveVoiceState, reduceLiveVoice } from '@/modules/chat/utils/liveVoiceMachine';
import type { LiveVoiceEvent } from '@/modules/chat/utils/liveVoiceMachine';
import { createTranscriptCollector } from '@/modules/chat/utils/transcriptCollector';
import { startMicCapture } from '@/modules/chat/utils/micCapture';
import type { MicCapture } from '@/modules/chat/utils/micCapture';
import {
  base64ToPcm16,
  floatToPcm16,
  pcm16ToBase64,
  resampleFloat,
  rmsLevel,
} from '@/modules/chat/utils/pcmAudio';
import { createVoiceActivityDetector } from '@/modules/chat/utils/voiceActivity';
import { api } from '@/shared/api';
import type { GeminiLiveStatus, LiveVoiceSnapshot, VoiceTranscriptRole } from '@/shared/types';

const MAX_RECONNECTS = 3;
const IDLE_CHECK_MS = 5_000;

type GeminiLiveOptions = {
  active: boolean;
  /** Changes with every new voice session, so starting another one reconnects even while `active` stays true. */
  runId: number;
  status: GeminiLiveStatus | null;
  voice: string | null;
  /** Sends a request into the voice session's Claude and resolves with its reply. */
  askClaude(request: string): Promise<string>;
  /** Text handed to the model as silent context when a fresh connection opens, or null when there is nothing to recall. Read at that moment. */
  getRecap(): Promise<string | null>;
  /** Called with each finished entry of the conversation: what Jason said, what the model said, and one-line notes about requests to Claude. */
  onTranscript(role: VoiceTranscriptRole, text: string, at: number): void;
  /** Called when the session ends by itself (idle timeout, dropped connection, no microphone), so the panel can switch back to stopped. */
  onEnded(reason: string): void;
};

async function decodeFrame(data: unknown): Promise<unknown> {
  // Google sends JSON text frames as binary; accept both.
  const text = typeof data === 'string' ? data : data instanceof Blob ? await data.text() : '';
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Gemini Live: speech to speech with a Google model that is the chatty voice
 * of one voice session. Anything real goes to that session's Claude through
 * the `ask_claude` tool. The browser asks the server for a one-use ephemeral
 * token (the real key stays on the server), connects to Google directly,
 * streams mic audio up and plays audio back. Everything said, both sides, is
 * handed to `onTranscript` as it finishes. It reconnects with the saved
 * resumption handle when Google announces the connection is ending or the
 * socket drops, and ends itself after two silent minutes. This sends audio to
 * Google. Returns a null snapshot while stopped.
 */
export function useGeminiLive(options: GeminiLiveOptions): {
  snapshot: LiveVoiceSnapshot | null;
  setMuted(muted: boolean): void;
} {
  const { active, status, runId } = options;
  // Live conversation state shown in the bar; null means the session is stopped.
  const [snapshot, setSnapshot] = useState<LiveVoiceSnapshot | null>(null);
  const snapshotRef = useRef<LiveVoiceSnapshot | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const mutedRef = useRef(false);
  const dispatchRef = useRef<(event: LiveVoiceEvent) => void>(() => {});

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    dispatchRef.current({ type: muted ? 'mute' : 'unmute' });
  }, []);

  const ready = Boolean(status?.configured);

  useEffect(() => {
    if (!active || !ready) {
      snapshotRef.current = null;
      setSnapshot(null);
      return undefined;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let mic: MicCapture | null = null;
    let player: GeminiAudioPlayer | null = null;
    let reconnects = 0;
    let setupDone = false;
    // After a local barge-in the rest of the interrupted reply is dropped until Google confirms the turn ended.
    let discardAudio = false;
    let modelSpeaking = false;
    let toolBusy = 0;
    // Joins transcription pieces into whole turns and saves each one as it finishes.
    const transcript = createTranscriptCollector((role, text, at) => optionsRef.current.onTranscript(role, text, at));
    const cancelled = new Set<string>();
    const tracker = createResumptionTracker();
    const detector = createVoiceActivityDetector();
    const watchdog = createIdleWatchdog(GEMINI_IDLE_TIMEOUT_MS, Date.now());

    const dispatch = (event: LiveVoiceEvent) => {
      if (disposed) return;
      const result = reduceLiveVoice(snapshotRef.current ?? createLiveVoiceState(), event);
      snapshotRef.current = result.state;
      setSnapshot(result.state);
      if (result.effects.includes('stopPlayback')) player?.stop();
    };
    dispatchRef.current = dispatch;

    const send = (message: Record<string, unknown>) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };

    const finishSpeaking = () => {
      modelSpeaking = false;
      dispatch({ type: 'replyEnd' });
    };

    const handleEvent = (event: GeminiServerEvent) => {
      tracker.apply(event);
      switch (event.kind) {
        case 'setupComplete':
          setupDone = true;
          reconnects = 0;
          dispatch({ type: 'ready' });
          // A connection with no saved handle starts blank, so it is told what was said before.
          if (!tracker.handle()) {
            void optionsRef.current.getRecap().then((recap) => {
              if (recap && !disposed) send(buildContextMessage(recap, false));
            }).catch(() => undefined);
          }
          break;
        case 'audio':
          if (discardAudio) break;
          watchdog.touch(Date.now());
          if (!modelSpeaking) {
            modelSpeaking = true;
            dispatch({ type: 'replyStart' });
          }
          player?.enqueue(base64ToPcm16(event.data));
          break;
        case 'interrupted':
          discardAudio = false;
          player?.stop();
          modelSpeaking = false;
          transcript.flush();
          break;
        case 'turnComplete':
          discardAudio = false;
          if (modelSpeaking) player?.onDrained(finishSpeaking);
          transcript.flush();
          break;
        case 'inputTranscript':
          transcript.heard(event.text);
          break;
        case 'outputTranscript':
          transcript.said(event.text);
          break;
        case 'toolCall':
          void runToolCalls(event.calls, {
            askClaude: (request) => optionsRef.current.askClaude(request),
            onNote: transcript.note,
            nonBlockingTools: Boolean(optionsRef.current.status?.nonBlockingTools),
            isCancelled: (id) => cancelled.has(id),
            onBusyChange: (busy) => {
              toolBusy += busy ? 1 : -1;
              watchdog.setBusy(toolBusy > 0, Date.now());
            },
            respond: ({ call, output, scheduling }) => {
              send(buildToolResponse(call, output, scheduling));
            },
          });
          break;
        case 'toolCancel':
          event.ids.forEach((id) => cancelled.add(id));
          break;
        case 'goAway':
          // Google is about to close this connection: continue on a fresh one using the saved handle.
          connect();
          break;
        default:
          break;
      }
    };

    const connect = async () => {
      const previous = socket;
      socket = null;
      previous?.close();
      setupDone = false;
      try {
        const response = await api.voice.geminiToken();
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(typeof body?.error === 'string' ? body.error : `Token request failed (${response.status})`);
        }
        const { token, model } = await response.json() as { token: string; model: string };
        if (disposed) return;

        const next = new WebSocket(buildLiveSocketUrl(token));
        socket = next;
        next.onopen = () => {
          next.send(JSON.stringify(buildSetupMessage({
            model,
            voice: optionsRef.current.voice || optionsRef.current.status?.defaultVoice || null,
            resumptionHandle: tracker.handle(),
            nonBlockingTools: Boolean(optionsRef.current.status?.nonBlockingTools),
          })));
        };
        next.onmessage = async (message) => {
          const decoded = await decodeFrame(message.data);
          if (disposed || socket !== next) return;
          parseServerMessage(decoded).forEach(handleEvent);
        };
        next.onclose = () => {
          // A socket we replaced ourselves is not a failure.
          if (disposed || socket !== next) return;
          if (reconnects < MAX_RECONNECTS) {
            reconnects += 1;
            void connect();
          } else {
            optionsRef.current.onEnded('The Gemini connection dropped.');
          }
        };
      } catch (error) {
        if (disposed) return;
        optionsRef.current.onEnded(error instanceof Error ? error.message : 'Could not start Gemini Live.');
      }
    };

    const onFrame = (samples: Float32Array) => {
      if (disposed || !mic) return;
      const sampleRate = mic.sampleRate;
      const ms = (samples.length / sampleRate) * 1000;
      const muted = mutedRef.current;
      const vad = detector.push(muted ? 0 : rmsLevel(samples), ms);

      if (vad?.type === 'start') {
        watchdog.touch(Date.now());
        // Barge-in: cut our playback now rather than waiting for Google's `interrupted`.
        if (modelSpeaking) {
          discardAudio = true;
          modelSpeaking = false;
        }
        dispatch({ type: 'speechStart' });
      } else if (vad?.type === 'end') {
        watchdog.touch(Date.now());
        dispatch({ type: 'speechEnd' });
      }

      if (!muted && setupDone) {
        const pcm = floatToPcm16(resampleFloat(samples, sampleRate, GEMINI_INPUT_SAMPLE_RATE));
        send(buildAudioMessage(pcm16ToBase64(pcm)));
      }
    };

    dispatch({ type: 'connect' });
    player = createGeminiAudioPlayer(GEMINI_OUTPUT_SAMPLE_RATE);
    void connect();
    startMicCapture(onFrame)
      .then((capture) => {
        if (disposed) capture.stop();
        else mic = capture;
      })
      .catch((error: unknown) => {
        const name = (error as { name?: string })?.name;
        optionsRef.current.onEnded(name === 'NotAllowedError' ? 'Microphone access denied.' : 'Could not open the microphone.');
      });

    const idleTimer = setInterval(() => {
      if (!watchdog.isExpired(Date.now())) return;
      optionsRef.current.onEnded('Ended after 2 minutes of silence.');
    }, IDLE_CHECK_MS);

    // The page can close without React running cleanups, so what is half said is saved as it hides.
    window.addEventListener('pagehide', transcript.flush);

    return () => {
      disposed = true;
      transcript.flush();
      window.removeEventListener('pagehide', transcript.flush);
      dispatchRef.current = () => {};
      clearInterval(idleTimer);
      const closing = socket;
      socket = null;
      closing?.close();
      mic?.stop();
      player?.close();
      snapshotRef.current = null;
    };
  }, [active, ready, runId]);

  return { snapshot, setMuted };
}
