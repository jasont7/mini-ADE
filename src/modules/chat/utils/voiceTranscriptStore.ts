import { api } from '@/shared/api';
import type { VoiceTranscriptEntry } from '@/shared/types';

const RETRY_DELAY_MS = 3_000;
const NO_ENTRIES: VoiceTranscriptEntry[] = [];

type VoiceTranscriptStoreDependencies = {
  /** Saves entries on the server. Resolves false (or rejects) when they were not saved. */
  save(sessionId: string, entries: VoiceTranscriptEntry[]): Promise<boolean>;
  load(sessionId: string): Promise<VoiceTranscriptEntry[]>;
};

/** What the chat reads and the live voice writes: every voice session's saved conversation, kept in memory and written to the server as it grows. */
export type VoiceTranscriptStore = {
  /** Adds an entry to the session's conversation and starts saving it. */
  append(sessionId: string, entry: VoiceTranscriptEntry): void;
  /** Reads the saved conversation from the server and merges it in. Entries added here meanwhile stay. */
  load(sessionId: string): Promise<void>;
  /** The session's entries, oldest first. The same array comes back until the entries change. */
  get(sessionId: string): VoiceTranscriptEntry[];
  subscribe(listener: () => void): () => void;
  /** Tries to save everything that is not saved yet right now, for example as the page closes. */
  flush(): void;
};

function insertSorted(list: VoiceTranscriptEntry[], entry: VoiceTranscriptEntry): VoiceTranscriptEntry[] {
  if (list.some((item) => item.id === entry.id)) return list;
  // After every entry that started at or before this one, so equal times keep the order they arrived in.
  let index = list.length;
  while (index > 0 && list[index - 1].at > entry.at) index -= 1;
  return [...list.slice(0, index), entry, ...list.slice(index)];
}

/**
 * Creates the store of voice session conversations. Every entry is saved as
 * soon as it is added, and an entry that could not be saved is kept and tried
 * again, so a dropped connection loses nothing while the page stays open.
 * Used by the live voice provider (writes) and the chat (reads).
 */
export function createVoiceTranscriptStore(dependencies: VoiceTranscriptStoreDependencies): VoiceTranscriptStore {
  const entriesBySession = new Map<string, VoiceTranscriptEntry[]>();
  // Entries that have not been saved yet, by session.
  const unsaved = new Map<string, VoiceTranscriptEntry[]>();
  const sending = new Set<string>();
  const listeners = new Set<() => void>();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = () => listeners.forEach((listener) => listener());
  const entriesOf = (sessionId: string) => entriesBySession.get(sessionId) ?? NO_ENTRIES;

  const flush = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    for (const [sessionId, batch] of unsaved) {
      if (sending.has(sessionId) || batch.length === 0) continue;
      sending.add(sessionId);
      const sent = new Set(batch.map((entry) => entry.id));
      dependencies.save(sessionId, batch)
        .catch(() => false)
        .then((saved) => {
          sending.delete(sessionId);
          if (saved) {
            const rest = (unsaved.get(sessionId) ?? []).filter((entry) => !sent.has(entry.id));
            if (rest.length > 0) {
              unsaved.set(sessionId, rest);
              flush();
            } else {
              unsaved.delete(sessionId);
            }
          } else if (!retryTimer) {
            retryTimer = setTimeout(flush, RETRY_DELAY_MS);
          }
        });
    }
  };

  return {
    append(sessionId, entry) {
      entriesBySession.set(sessionId, insertSorted(entriesOf(sessionId), entry));
      unsaved.set(sessionId, [...(unsaved.get(sessionId) ?? []), entry]);
      emit();
      flush();
    },

    async load(sessionId) {
      const saved = await dependencies.load(sessionId);
      let merged = entriesOf(sessionId);
      for (const entry of saved) merged = insertSorted(merged, entry);
      if (merged !== entriesOf(sessionId)) {
        entriesBySession.set(sessionId, merged);
        emit();
      }
    },

    get: entriesOf,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    flush,
  };
}

/** The app's one store, wired to the server. */
export const voiceTranscriptStore = createVoiceTranscriptStore({
  save: async (sessionId, entries) => (await api.voice.appendVoiceTranscript(sessionId, entries)).ok,
  load: async (sessionId) => {
    const response = await api.voice.voiceTranscript(sessionId);
    if (!response.ok) throw new Error(`Could not read the voice transcript (${response.status}).`);
    const body = await response.json() as { entries?: VoiceTranscriptEntry[] };
    return Array.isArray(body.entries) ? body.entries : [];
  },
});
