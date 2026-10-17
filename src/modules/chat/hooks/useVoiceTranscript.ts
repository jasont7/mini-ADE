import { useEffect, useSyncExternalStore } from 'react';

import { voiceTranscriptStore } from '@/modules/chat/utils/voiceTranscriptStore';
import type { VoiceTranscriptEntry } from '@/shared/types';

const NO_ENTRIES: VoiceTranscriptEntry[] = [];

/**
 * The saved conversation of a voice session, oldest first, kept current while
 * the live voice adds to it. Loads it from the server when the session opens
 * and returns nothing for a session that is not a voice session. Used by the
 * chat interface to draw the voice rows between Claude's.
 */
export function useVoiceTranscript(sessionId: string | null, isVoiceSession: boolean): VoiceTranscriptEntry[] {
  const active = isVoiceSession && sessionId !== null;
  useEffect(() => {
    if (active) void voiceTranscriptStore.load(sessionId).catch(() => undefined);
  }, [active, sessionId]);
  return useSyncExternalStore(
    voiceTranscriptStore.subscribe,
    () => (active ? voiceTranscriptStore.get(sessionId) : NO_ENTRIES),
  );
}
