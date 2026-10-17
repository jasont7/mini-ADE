import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { GeminiLiveStatus } from '@/shared/types';

/**
 * Reads whether the server can offer Gemini Live (key present) and which
 * voices it has. Null while loading or if the request fails, in which case the
 * Gemini Live button shows as unavailable instead of breaking. Used by the chat
 * module's live voice and by the settings module's Gemini voice select.
 */
export function useGeminiLiveStatus(): GeminiLiveStatus | null {
  // Server-reported availability; fetched once because it only changes when the server restarts.
  const [status, setStatus] = useState<GeminiLiveStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.voice.geminiStatus()
      .then(async (response) => (response.ok ? ((await response.json()) as GeminiLiveStatus) : null))
      .then((value) => {
        if (!cancelled) setStatus(value);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
