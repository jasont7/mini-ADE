import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  VoiceServiceResult,
  VoiceTranscriptEntry,
  VoiceTranscriptRole,
  VoiceTranscriptService,
} from '@/shared/types.js';

type VoiceTranscriptStore = {
  markVoiceSession(sessionId: string, name: string | null): void;
  getVoiceSessionName(sessionId: string): string | null | undefined;
  listVoiceSessionIds(): string[];
  appendEntries(sessionId: string, entries: VoiceTranscriptEntry[]): VoiceTranscriptEntry[];
  listEntries(sessionId: string): VoiceTranscriptEntry[];
};

type VoiceTranscriptDependencies = {
  store: VoiceTranscriptStore;
  /** Folder inside mini-ADE's own data folder that holds the markdown copies. Never a project folder. */
  directory: string;
};

const MAX_ENTRIES_PER_REQUEST = 100;
const MAX_TEXT_CHARS = 4_000;
const MAX_NAME_CHARS = 200;
const ROLES: readonly VoiceTranscriptRole[] = ['user', 'gemini', 'tool'];
const ROLE_LABELS: Record<VoiceTranscriptRole, string> = { user: 'You', gemini: 'Voice', tool: 'Claude' };
// Session ids become file names, so only ids that cannot leave the folder are accepted.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

function parseEntries(raw: unknown): VoiceTranscriptEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ENTRIES_PER_REQUEST) return null;
  const entries: VoiceTranscriptEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const { id, role, text, at } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !id || id.length > 100) return null;
    if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) return null;
    if (typeof text !== 'string' || !text.trim()) return null;
    if (typeof at !== 'number' || !Number.isFinite(at)) return null;
    entries.push({ id, role: role as VoiceTranscriptRole, text: text.trim().slice(0, MAX_TEXT_CHARS), at: Math.round(at) });
  }
  return entries;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatStamp(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatLine(entry: VoiceTranscriptEntry): string {
  return `- ${formatStamp(entry.at)} **${ROLE_LABELS[entry.role]}:** ${entry.text.replace(/\s+/g, ' ')}\n`;
}

/**
 * Creates the service that keeps voice sessions' conversations. Entries go to
 * the database first, then to a plain markdown copy named after the session
 * id in mini-ADE's own data folder, so the copy can be searched later. A
 * failure writing the copy never loses entries: the database already has them.
 */
export function createVoiceTranscriptService(dependencies: VoiceTranscriptDependencies): VoiceTranscriptService {
  const filePath = (sessionId: string) => path.join(dependencies.directory, `${sessionId}.md`);
  const invalidId: VoiceServiceResult<never> = { ok: false, status: 400, error: 'Invalid session id' };

  return {
    async registerSession(sessionId, input) {
      if (!SESSION_ID_PATTERN.test(sessionId)) return invalidId;
      const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, MAX_NAME_CHARS) : null;
      const isNew = dependencies.store.getVoiceSessionName(sessionId) === undefined;
      dependencies.store.markVoiceSession(sessionId, name);
      if (isNew) {
        try {
          await mkdir(dependencies.directory, { recursive: true });
          // 'wx' keeps a copy that already exists (restored from a backup, say).
          await writeFile(filePath(sessionId), `# ${name ?? 'Voice session'}\n\nSession ${sessionId}\n\n`, { flag: 'wx' });
        } catch {
          // Appending later creates the file without a header.
        }
      }
      return { ok: true, value: { sessionId } };
    },

    listSessionIds: () => dependencies.store.listVoiceSessionIds(),

    list(sessionId) {
      if (!SESSION_ID_PATTERN.test(sessionId)) return invalidId;
      return { ok: true, value: dependencies.store.listEntries(sessionId) };
    },

    async append(sessionId, raw) {
      if (!SESSION_ID_PATTERN.test(sessionId)) return invalidId;
      const entries = parseEntries(raw);
      if (!entries) return { ok: false, status: 400, error: 'entries must be 1 to 100 entries with id, role, text and at' };
      const added = dependencies.store.appendEntries(sessionId, entries);
      if (added.length > 0) {
        try {
          await mkdir(dependencies.directory, { recursive: true });
          await appendFile(filePath(sessionId), added.map(formatLine).join(''));
        } catch {
          // The database has the entries, so a copy that cannot be written is not worth failing the request.
        }
      }
      return { ok: true, value: { added: added.length } };
    },
  };
}
