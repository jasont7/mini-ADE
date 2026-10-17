import { getConnection } from '@/modules/database/connection.js';
import type { VoiceTranscriptRole } from '@/shared/types.js';

type EntryRow = { id: string; role: VoiceTranscriptRole; text: string; at: number };

/** One saved entry of a voice session, as the Voice service reads and writes it. */
export type VoiceTranscriptRecord = {
  id: string;
  role: VoiceTranscriptRole;
  text: string;
  /** Epoch milliseconds the entry started at. */
  at: number;
};

export const voiceTranscriptDb = {
  /** Marks a session as a voice session. Marking it again keeps the first name. */
  markVoiceSession(sessionId: string, name: string | null): void {
    getConnection()
      .prepare('INSERT OR IGNORE INTO voice_sessions (session_id, name) VALUES (?, ?)')
      .run(sessionId, name);
  },

  /** Returns the name saved for a voice session, or undefined when the session is not a voice session. */
  getVoiceSessionName(sessionId: string): string | null | undefined {
    const row = getConnection()
      .prepare('SELECT name FROM voice_sessions WHERE session_id = ?')
      .get(sessionId) as { name: string | null } | undefined;
    return row ? row.name : undefined;
  },

  /** Lists the ids of every voice session. */
  listVoiceSessionIds(): string[] {
    const rows = getConnection().prepare('SELECT session_id FROM voice_sessions').all() as { session_id: string }[];
    return rows.map((row) => row.session_id);
  },

  /** Inserts the entries that are not saved yet and returns the ones that were new, in the order given. */
  appendEntries(sessionId: string, entries: VoiceTranscriptRecord[]): VoiceTranscriptRecord[] {
    const connection = getConnection();
    const insert = connection.prepare(
      'INSERT OR IGNORE INTO voice_transcript_entries (id, session_id, role, text, at) VALUES (?, ?, ?, ?, ?)',
    );
    const added: VoiceTranscriptRecord[] = [];
    connection.transaction(() => {
      for (const entry of entries) {
        if (insert.run(entry.id, sessionId, entry.role, entry.text, entry.at).changes > 0) added.push(entry);
      }
    })();
    return added;
  },

  /** Returns every entry of a session, oldest first. Entries with the same time keep the order they were saved in. */
  listEntries(sessionId: string): VoiceTranscriptRecord[] {
    const rows = getConnection()
      .prepare('SELECT id, role, text, at FROM voice_transcript_entries WHERE session_id = ? ORDER BY at, rowid')
      .all(sessionId) as EntryRow[];
    return rows.map((row) => ({ id: row.id, role: row.role, text: row.text, at: row.at }));
  },
};
