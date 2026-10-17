import { getConnection } from '@/modules/database/connection.js';

type VoiceSettingsRow = {
  session_id: string;
  mode: string;
  gemini_voice: string | null;
};

/** Stored live voice settings of one session, as the Voice service reads them. */
export type SessionVoiceSettingsRecord = {
  sessionId: string;
  mode: string;
  geminiVoice: string | null;
};

export const sessionVoiceSettingsDb = {
  /** Returns the stored settings for a session, or null when none were ever saved. */
  get(sessionId: string): SessionVoiceSettingsRecord | null {
    const row = getConnection()
      .prepare('SELECT session_id, mode, gemini_voice FROM session_voice_settings WHERE session_id = ?')
      .get(sessionId) as VoiceSettingsRow | undefined;
    return row
      ? { sessionId: row.session_id, mode: row.mode, geminiVoice: row.gemini_voice }
      : null;
  },

  /** Inserts or replaces the settings of a session. */
  upsert(record: SessionVoiceSettingsRecord): void {
    getConnection()
      .prepare(
        `INSERT INTO session_voice_settings (session_id, mode, gemini_voice, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(session_id) DO UPDATE SET
           mode = excluded.mode,
           gemini_voice = excluded.gemini_voice,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(record.sessionId, record.mode, record.geminiVoice);
  },
};
