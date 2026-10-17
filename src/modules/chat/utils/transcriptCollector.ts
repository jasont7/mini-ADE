import type { VoiceTranscriptRole } from '@/shared/types';

/** Gathers the pieces of a live conversation into whole turns and hands each finished turn over in the order it happened. */
export type TranscriptCollector = {
  /** A piece of what Jason said. It also closes whatever the model was saying. */
  heard(text: string): void;
  /** A piece of what the model said. It also closes whatever Jason was saying. */
  said(text: string): void;
  /** A one-line note, such as a request to Claude. Whatever is half said goes first, so the order reads as it happened. */
  note(text: string): void;
  /** Hands over whatever is half said. Called when a turn ends, is interrupted, or the call ends. */
  flush(): void;
};

/**
 * Creates the collector the Gemini live hook feeds with its transcription
 * events. Transcription arrives in small pieces, so pieces are joined until
 * the other side starts or the turn ends, and only then handed to `save` with
 * the time the turn started at.
 */
export function createTranscriptCollector(
  save: (role: VoiceTranscriptRole, text: string, at: number) => void,
  now: () => number = Date.now,
): TranscriptCollector {
  let heard = { text: '', at: 0 };
  let said = { text: '', at: 0 };

  const emit = (role: VoiceTranscriptRole, turn: { text: string; at: number }) => {
    if (turn.text.trim()) save(role, turn.text.trim(), turn.at);
  };
  const closeHeard = () => {
    emit('user', heard);
    heard = { text: '', at: 0 };
  };
  const closeSaid = () => {
    emit('gemini', said);
    said = { text: '', at: 0 };
  };
  const flush = () => {
    closeHeard();
    closeSaid();
  };

  return {
    heard(text) {
      closeSaid();
      if (!heard.text) heard.at = now();
      heard.text += text;
    },
    said(text) {
      closeHeard();
      if (!said.text) said.at = now();
      said.text += text;
    },
    note(text) {
      flush();
      save('tool', text, now());
    },
    flush,
  };
}
