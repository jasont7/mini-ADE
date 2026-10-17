import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { SessionVoiceSettings } from '@/shared/types';

const OFF: SessionVoiceSettings = { mode: 'off', geminiVoice: null };

/** Reads a stored row, treating any mode this build does not know (such as the retired 'private') as off. */
function normalizeSettings(value: { mode?: unknown; geminiVoice?: unknown } | null | undefined): SessionVoiceSettings {
  return {
    mode: value?.mode === 'gemini' ? 'gemini' : 'off',
    geminiVoice: typeof value?.geminiVoice === 'string' ? value.geminiVoice : null,
  };
}

/**
 * The live voice mode of the open session. Reads it from the server when a
 * session opens and writes every change back. A brand new chat has no session
 * id yet: its choice is held locally and saved the moment the session is
 * established, so the pick made at creation persists with the session. Used by
 * the live voice hook.
 */
export function useSessionVoiceSettings(sessionId: string | null): {
  settings: SessionVoiceSettings;
  update(next: SessionVoiceSettings): void;
} {
  // The picker's current value for the open chat, kept locally so the UI responds before the server answers.
  const [settings, setSettings] = useState<SessionVoiceSettings>(OFF);
  // True while a choice made on a session-less chat still has to be saved once the session exists.
  const unsavedRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    if (!sessionId) return undefined;
    if (unsavedRef.current) {
      unsavedRef.current = false;
      void api.voice.setSessionMode(sessionId, settingsRef.current);
      return undefined;
    }

    let cancelled = false;
    api.voice.getSessionMode(sessionId)
      .then(async (response) => (response.ok ? normalizeSettings((await response.json()) as SessionVoiceSettings) : OFF))
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch(() => {
        if (!cancelled) setSettings(OFF);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // A session-less chat that is replaced by another new chat starts from Off again.
  useEffect(() => {
    if (!sessionId) {
      unsavedRef.current = false;
      setSettings(OFF);
    }
  }, [sessionId]);

  const update = useCallback((next: SessionVoiceSettings) => {
    setSettings(next);
    if (sessionId) void api.voice.setSessionMode(sessionId, next);
    else unsavedRef.current = true;
  }, [sessionId]);

  return { settings, update };
}
