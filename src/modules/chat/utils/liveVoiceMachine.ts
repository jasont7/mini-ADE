import type { LiveVoicePhase, LiveVoiceSnapshot } from '@/shared/types';

/** Events the live voice hooks feed the state machine. */
export type LiveVoiceEvent =
  | { type: 'connect' }
  | { type: 'ready' }
  | { type: 'speechStart' }
  | { type: 'speechEnd' }
  | { type: 'replyStart' }
  | { type: 'replyEnd' }
  | { type: 'mute' }
  | { type: 'unmute' }
  | { type: 'fail'; error: string }
  | { type: 'stop' };

/** Side effects the hook must perform after a transition. */
export type LiveVoiceEffect = 'stopPlayback';

const INITIAL: LiveVoiceSnapshot = { phase: 'connecting', muted: false, error: null };

/** Starting snapshot of a live voice session. Used by the Private and Gemini live hooks. */
export function createLiveVoiceState(): LiveVoiceSnapshot {
  return { ...INITIAL };
}

function withPhase(state: LiveVoiceSnapshot, phase: LiveVoicePhase): LiveVoiceSnapshot {
  return state.phase === phase ? state : { ...state, phase };
}

/**
 * Pure transition function of the hands-free conversation. The key rule is
 * barge-in: speech while the reply is playing returns to listening and asks
 * the caller to stop playback. A muted microphone never produces speech
 * events, but replies keep playing. Used by the Private and Gemini live hooks.
 */
export function reduceLiveVoice(
  state: LiveVoiceSnapshot,
  event: LiveVoiceEvent,
): { state: LiveVoiceSnapshot; effects: LiveVoiceEffect[] } {
  if (state.phase === 'error' && event.type !== 'connect' && event.type !== 'stop') {
    return { state, effects: [] };
  }

  switch (event.type) {
    case 'connect':
      return { state: { ...state, phase: 'connecting', error: null }, effects: [] };
    case 'ready':
      return { state: state.phase === 'connecting' ? withPhase(state, 'listening') : state, effects: [] };
    case 'speechStart':
      if (state.muted || state.phase === 'connecting') return { state, effects: [] };
      // Speaking again clears the previous turn's error line.
      if (state.phase === 'speaking') {
        return { state: { ...state, phase: 'listening', error: null }, effects: ['stopPlayback'] };
      }
      return { state: state.error ? { ...state, error: null } : state, effects: [] };
    case 'speechEnd':
      if (state.muted) return { state, effects: [] };
      return { state: state.phase === 'listening' ? withPhase(state, 'thinking') : state, effects: [] };
    case 'replyStart':
      return { state: state.phase === 'connecting' ? state : withPhase(state, 'speaking'), effects: [] };
    case 'replyEnd':
      return {
        state: state.phase === 'speaking' || state.phase === 'thinking' ? withPhase(state, 'listening') : state,
        effects: [],
      };
    case 'mute':
      return { state: { ...state, muted: true }, effects: [] };
    case 'unmute':
      return { state: { ...state, muted: false }, effects: [] };
    case 'fail':
      return { state: { ...state, phase: 'error', error: event.error }, effects: ['stopPlayback'] };
    case 'stop':
      return { state: createLiveVoiceState(), effects: ['stopPlayback'] };
  }
}
