import { voiceId, voicePlayer } from '@/modules/chat/utils/voicePlayer';
import type { NormalizedMessage } from '@/shared/types';
import { readVoiceConfig } from '@/shared/voiceConfig';

/**
 * Marker a voice backend can prepend to transcripts (the advisor's local Whisper server does),
 * so a spoken message is recognisable after it has been sent and the reply can come back as speech.
 */
export const VOICE_MESSAGE_MARKER = '[voice]';

// Replies already read aloud, by audio id. A `complete` can be replayed after a reconnect,
// and the same reply must not be spoken twice.
const spoken = new Set<string>();
const SPOKEN_MAX = 50;

// While a hands-free live session runs it does its own speaking (Gemini speaks Claude's answer itself,
// Private live has its own player), so reading the same reply aloud again would put two voices on top
// of each other. The live voice hook flips this on and off.
let liveVoiceActive = false;
export function setLiveVoiceActive(active: boolean): void {
  liveVoiceActive = active;
}

/**
 * The text to read aloud when a turn completes: the last assistant text row after the latest
 * user message. Null when the mode is off, when there's no reply text, or in 'voice' mode when
 * the user's message wasn't spoken.
 */
export function autoSpeakText(messages: NormalizedMessage[], mode: string): string | null {
  if (liveVoiceActive) return null;
  if (mode !== 'voice' && mode !== 'always') return null;

  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].kind === 'text' && messages[i].role === 'user') {
      lastUser = i;
      break;
    }
  }
  if (lastUser === -1) return null;
  if (mode === 'voice' && !String(messages[lastUser].content ?? '').trimStart().startsWith(VOICE_MESSAGE_MARKER)) {
    return null;
  }

  for (let i = messages.length - 1; i > lastUser; i--) {
    const m = messages[i];
    const text = String(m.content ?? '').trim();
    if (m.kind === 'text' && m.role === 'assistant' && text) return text;
  }
  return null;
}

/** Called when a turn completes in the session on screen. Plays nothing while the app is hidden. */
export function maybeAutoSpeak(messages: NormalizedMessage[]): void {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  const text = autoSpeakText(messages, readVoiceConfig().autoSpeak);
  if (!text) return;
  const id = voiceId(text);
  if (spoken.has(id)) return;
  spoken.add(id);
  if (spoken.size > SPOKEN_MAX) spoken.delete(spoken.values().next().value as string);
  voicePlayer.speak(text);
}
