import { VOICE_MESSAGE_PREFIX } from '@/modules/chat/utils/voiceBridge';
import type { ChatMessage, VoiceTranscriptEntry } from '@/shared/types';

type VoiceSessionApi = {
  createSession(payload: { provider: string; projectPath: string; initialMessage: string }): Promise<Response>;
  registerVoiceSession(sessionId: string, name: string | null): Promise<Response>;
};

/** Sent to Claude once (after the `[voice]` tag every request carries), as the first message of a new voice session, so it knows how to answer before the first request comes. */
export const VOICE_SESSION_INTRO = `This is a voice session. Jason speaks and his words are transcribed to text, which reaches you here as messages that start with [voice]. There is no other assistant in between, you are the only agent he talks to. Keep every reply to 1 to 4 short plain sentences with no markdown, code or lists, because it is read out loud. Do not answer with anything yet. Wait for his requests. Reply to this message with only the word Ready.`;

/** The intro as it appears in the session, with the tag the hub puts in front of every request. */
const VOICE_SESSION_INTRO_MESSAGE = `${VOICE_MESSAGE_PREFIX}${VOICE_SESSION_INTRO}`;

/** How many of the latest saved entries a resumed voice session hands the model so it is not blank. */
export const RECAP_ENTRY_COUNT = 8;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROLE_LABELS = { user: 'Jason', gemini: 'You', tool: 'Claude' } as const;
const RECAP_ENTRY_MAX_CHARS = 240;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The name a new voice session starts with, such as "Voice, Oct 11 15:40".
 * Exactly four words, which is all the server keeps of a first message, so
 * it can be sent as that message and come back as the session's name.
 */
export function defaultVoiceSessionName(now: Date): string {
  return `Voice, ${MONTHS[now.getMonth()]} ${now.getDate()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * A short plain-text recap of the latest saved entries, handed to Gemini as
 * silent context when a voice session continues, or null when nothing was
 * said yet. Used by the live voice provider.
 */
export function buildVoiceRecap(entries: VoiceTranscriptEntry[]): string | null {
  const recent = entries.slice(-RECAP_ENTRY_COUNT);
  if (recent.length === 0) return null;
  const lines = recent.map((entry) => {
    const text = entry.text.replace(/\s+/g, ' ').trim();
    const shown = text.length > RECAP_ENTRY_MAX_CHARS ? `${text.slice(0, RECAP_ENTRY_MAX_CHARS - 1)}…` : text;
    return `${ROLE_LABELS[entry.role]}: ${shown}`;
  });
  return `Context: this call continues an earlier conversation in the same session. The last turns were:\n${lines.join('\n')}\nDo not repeat them. Carry on from here when Jason speaks.`;
}

/**
 * Turns a voice session's saved entries into transcript rows and interleaves
 * them with Claude's rows by time. Rows keep their own order: a voice row goes
 * before the first Claude row that started after it, so nothing of Claude's is
 * ever reordered. While older rows of Claude's are not loaded yet
 * (`hasEarlierMessages`), voice rows from before the first loaded row wait too.
 * The first-message prompt that sets a voice session up is
 * left out. Used by the chat interface for sessions that are voice sessions.
 */
export function mergeVoiceRows(messages: ChatMessage[], entries: VoiceTranscriptEntry[], hasEarlierMessages = false): ChatMessage[] {
  const visible = messages.filter((message) => !(message.type === 'user' && message.content === VOICE_SESSION_INTRO_MESSAGE));
  if (entries.length === 0) return visible;
  const firstTime = visible.length > 0 ? new Date(visible[0].timestamp).getTime() : NaN;
  const shown = hasEarlierMessages && Number.isFinite(firstTime) ? entries.filter((entry) => entry.at >= firstTime) : entries;
  const voiceRows: (ChatMessage & { at: number })[] = shown.map((entry) => ({
    id: entry.id,
    type: 'voice',
    voiceRole: entry.role,
    content: entry.text,
    timestamp: entry.at,
    at: entry.at,
  }));
  const merged: ChatMessage[] = [];
  let next = 0;
  for (const message of visible) {
    const time = new Date(message.timestamp).getTime();
    while (next < voiceRows.length && Number.isFinite(time) && voiceRows[next].at <= time) {
      merged.push(voiceRows[next]);
      next += 1;
    }
    merged.push(message);
  }
  return merged.concat(voiceRows.slice(next));
}

/**
 * Creates the session behind a new voice session: asks the server for a
 * session in the project, named like "Voice, Oct 11 15:40", and marks it as a
 * voice session. Resolves with the session's id and the name the server kept.
 * Throws a sentence the panel can show when either step fails. Used by the
 * live voice hook.
 */
export async function createVoiceSession(
  api: VoiceSessionApi,
  input: { projectPath: string; now: Date },
): Promise<{ sessionId: string; name: string }> {
  const proposedName = defaultVoiceSessionName(input.now);
  const created = await api.createSession({ provider: 'claude', projectPath: input.projectPath, initialMessage: proposedName });
  if (!created.ok) throw new Error(`Could not create the session (${created.status}).`);
  const body = await created.json();
  const sessionId = typeof body?.data?.sessionId === 'string' ? body.data.sessionId : '';
  if (!sessionId) throw new Error('The server returned no session id.');
  const name = typeof body?.data?.sessionName === 'string' && body.data.sessionName.trim() ? body.data.sessionName.trim() : proposedName;
  const registered = await api.registerVoiceSession(sessionId, name);
  if (!registered.ok) throw new Error(`Could not mark the session as a voice session (${registered.status}).`);
  return { sessionId, name };
}
