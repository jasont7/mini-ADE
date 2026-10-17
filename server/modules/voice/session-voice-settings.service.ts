import type {
  SessionVoiceSettings,
  SessionVoiceSettingsService,
  VoiceMode,
} from '@/shared/types.js';

type SessionVoiceSettingsStore = {
  get(sessionId: string): { mode: string; geminiVoice: string | null } | null;
  upsert(record: { sessionId: string; mode: string; geminiVoice: string | null }): void;
};

type SessionVoiceSettingsDependencies = {
  store: SessionVoiceSettingsStore;
  /** Voice presets the Gemini front accepts. */
  voices: readonly string[];
};

const VOICE_MODES: readonly VoiceMode[] = ['off', 'private', 'gemini'];

function isVoiceMode(value: unknown): value is VoiceMode {
  return typeof value === 'string' && (VOICE_MODES as readonly string[]).includes(value);
}

/**
 * Creates the service that stores each session's live voice mode. A voice
 * preset is only kept when it is one of the known Gemini presets.
 */
export function createSessionVoiceSettingsService(
  dependencies: SessionVoiceSettingsDependencies,
): SessionVoiceSettingsService {
  return {
    get(sessionId) {
      const stored = dependencies.store.get(sessionId);
      if (!stored || !isVoiceMode(stored.mode)) {
        return { mode: 'off', geminiVoice: null };
      }
      return { mode: stored.mode, geminiVoice: stored.geminiVoice };
    },

    set(sessionId, input) {
      if (!isVoiceMode(input.mode)) {
        return { ok: false, status: 400, error: 'mode must be off, private or gemini' };
      }

      let geminiVoice: string | null = null;
      if (input.geminiVoice !== undefined && input.geminiVoice !== null) {
        if (typeof input.geminiVoice !== 'string' || !dependencies.voices.includes(input.geminiVoice)) {
          return { ok: false, status: 400, error: 'Unknown Gemini voice' };
        }
        geminiVoice = input.geminiVoice;
      }

      const value: SessionVoiceSettings = { mode: input.mode, geminiVoice };
      dependencies.store.upsert({ sessionId, ...value });
      return { ok: true, value };
    },
  };
}
