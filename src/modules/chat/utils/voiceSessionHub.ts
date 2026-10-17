import { VOICE_MESSAGE_PREFIX } from '@/modules/chat/utils/voiceBridge';
import type { ServerEvent, VoiceDirectory, VoiceSessionEntry, VoiceTarget } from '@/shared/types';

const START_TIMEOUT_MS = 20_000;
const REPLY_TIMEOUT_MS = 10 * 60_000;
const TEXTS_KEPT = 8;
const TEXT_MAX_CHARS = 4_000;

type SessionStatus = 'running' | 'idle' | 'waiting for permission' | 'waiting for input';

/** What the hub has seen of one session over the websocket since the page loaded. */
type SessionRecord = {
  // Epoch ms of the newest frame, 0 when none arrived yet.
  lastFrameAt: number;
  // Epoch ms of the newest `complete`, 0 when none arrived yet.
  completedAt: number;
  // The newest assistant text rows, which are what a reply is built from.
  texts: { id: string; at: number; text: string }[];
  // Streamed text that was closed without a text row, used only when no text row came.
  streams: { at: number; text: string }[];
  // Text of the stream still being received.
  openStream: string;
  // Open permission or input requests by request id.
  waiting: Map<string, 'permission' | 'input'>;
};

type PendingRequest = {
  // Null while a brand new chat has no session id yet.
  sessionId: string | null;
  sessionName: string;
  startedAt: number;
  sawFrame: boolean;
  resolve(reply: string): void;
  reject(error: Error): void;
  startTimer: ReturnType<typeof setTimeout>;
  replyTimer: ReturnType<typeof setTimeout>;
};

/** What the hub needs from the app. Everything is read at call time, so nothing here has to be re-registered when it changes. */
export type VoiceSessionHubDependencies = {
  send(frame: Record<string, unknown>): void;
  getDirectory(): VoiceDirectory | null;
  getTarget(): VoiceTarget | null;
  /** Options sent with a message into a session that is not on screen. */
  buildSendOptions(session: VoiceSessionEntry): Record<string, unknown>;
  now(): number;
};

/** The live voice's way into Claude: sends a request into a session and returns the reply, reading both from the websocket frames the app already receives. */
export type VoiceSessionHub = {
  handleEvent(event: ServerEvent): void;
  /**
   * Sends `request` into a session as a `[voice]` message and resolves with
   * Claude's reply when the turn ends. `sessionId` undefined means the session
   * on screen. A session that is busy, or waiting for Jason, is refused with a
   * sentence the model can say instead of queueing the request. A request to
   * the on-screen session goes through the composer, so the message shows at
   * once. Any other goes out as a `chat.send` frame.
   */
  askSession(sessionId: string | undefined, request: string): Promise<string>;
  /** Tells the hub a chat that had no session id now has one, so a waiting request can follow it. */
  bindNewSession(sessionId: string): void;
  /** Rejects every waiting request. Called when the voice session ends. */
  dispose(reason: string): void;
};

function permissionKind(toolName: unknown): 'permission' | 'input' {
  return toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode' || toolName === 'exit_plan_mode' ? 'input' : 'permission';
}

function createRecord(): SessionRecord {
  return { lastFrameAt: 0, completedAt: 0, texts: [], streams: [], openStream: '', waiting: new Map() };
}

/**
 * Tracks the sessions' replies from the websocket frames the app already
 * receives. Any number of requests to different sessions can wait at once. A
 * reply is built from the assistant rows of the turn, or from the streamed
 * text when no row came. Used by the live voice provider, which wires it to
 * the websocket.
 */
export function createVoiceSessionHub(deps: VoiceSessionHubDependencies): VoiceSessionHub {
  const records = new Map<string, SessionRecord>();
  const pending = new Map<string | null, PendingRequest>();

  const recordFor = (sessionId: string): SessionRecord => {
    let record = records.get(sessionId);
    if (!record) {
      record = createRecord();
      records.set(sessionId, record);
    }
    return record;
  };

  const entryFor = (sessionId: string): VoiceSessionEntry | null => (
    deps.getDirectory()?.sessions.find((session) => session.id === sessionId) ?? null
  );

  const settle = (key: string | null, outcome: { reply: string } | { error: Error }) => {
    const request = pending.get(key);
    if (!request) return;
    pending.delete(key);
    clearTimeout(request.startTimer);
    clearTimeout(request.replyTimer);
    if ('error' in outcome) request.reject(outcome.error);
    else request.resolve(outcome.reply);
  };

  const replyFor = (record: SessionRecord, since: number): string => {
    const rows = record.texts.filter((row) => row.at >= since).map((row) => row.text);
    if (rows.length > 0) return rows.join('\n\n');
    return record.streams.filter((stream) => stream.at >= since).map((stream) => stream.text).join('\n\n');
  };

  const finishTurn = (sessionId: string, request: PendingRequest, success: boolean, aborted: boolean) => {
    const reply = replyFor(recordFor(sessionId), request.startedAt);
    if (reply) settle(request.sessionId, { reply });
    else if (aborted) settle(request.sessionId, { reply: `The run in '${request.sessionName}' was stopped before it replied.` });
    else if (!success) settle(request.sessionId, { error: new Error(`The run in '${request.sessionName}' failed.`) });
    else settle(request.sessionId, { reply: `'${request.sessionName}' finished without a text reply.` });
  };

  const statusOf = (sessionId: string): SessionStatus => {
    const waiting = records.get(sessionId)?.waiting;
    if (waiting && waiting.size > 0) return [...waiting.values()].includes('input') ? 'waiting for input' : 'waiting for permission';
    if (pending.has(sessionId) || deps.getDirectory()?.busyIds.has(sessionId)) return 'running';
    return 'idle';
  };

  const startRequest = (sessionId: string | null, sessionName: string): Promise<string> => new Promise<string>((resolve, reject) => {
    pending.set(sessionId, {
      sessionId,
      sessionName,
      startedAt: deps.now(),
      sawFrame: false,
      resolve,
      reject,
      startTimer: setTimeout(
        () => settle(sessionId, { error: new Error(`'${sessionName}' did not start on the request.`) }),
        START_TIMEOUT_MS,
      ),
      replyTimer: setTimeout(
        () => settle(sessionId, { error: new Error(`'${sessionName}' took too long to answer. It may still be working.`) }),
        REPLY_TIMEOUT_MS,
      ),
    });
  });

  const noteWaiting = (sessionId: string, event: ServerEvent) => {
    const requestId = typeof event.requestId === 'string' ? event.requestId : null;
    if (!requestId) return;
    const record = recordFor(sessionId);
    if (record.waiting.has(requestId)) return;
    const kind = permissionKind(event.toolName);
    record.waiting.set(requestId, kind);

    // The turn is paused until he answers, so say so now instead of leaving the tool call hanging.
    if (!pending.has(sessionId)) return;
    const name = entryFor(sessionId)?.name ?? 'The session';
    const what = kind === 'input'
      ? `is waiting for Jason's answer`
      : `is waiting for permission to use ${typeof event.toolName === 'string' ? event.toolName : 'a tool'}`;
    settle(sessionId, { reply: `'${name}' ${what}. He can open it to answer, then it carries on.` });
  };

  const handleEvent = (event: ServerEvent) => {
    const kind = event.kind;
    const sessionId = typeof event.sessionId === 'string' && event.sessionId ? event.sessionId : null;
    if (!kind || !sessionId) return;

    if (kind === 'chat_subscribed') {
      const record = recordFor(sessionId);
      record.waiting.clear();
      if (Array.isArray(event.pendingPermissions)) {
        for (const item of event.pendingPermissions as { requestId?: unknown; toolName?: unknown }[]) {
          if (typeof item?.requestId === 'string') record.waiting.set(item.requestId, permissionKind(item.toolName));
        }
      }
      return;
    }
    // Sidebar and gateway frames about a session are not part of its conversation.
    if (kind === 'session_upserted' || kind === 'session_view_state' || kind === 'loading_progress' || kind === 'background_tasks') return;

    const now = deps.now();
    const record = recordFor(sessionId);
    const request = pending.get(sessionId);

    if (kind === 'protocol_error') {
      if (request) settle(sessionId, { error: new Error(typeof event.error === 'string' && event.error ? event.error : 'The request was rejected.') });
      return;
    }

    record.lastFrameAt = now;
    // A `complete` before anything else is the end of an earlier run, not an answer to this request.
    if (request && kind !== 'complete') {
      request.sawFrame = true;
      clearTimeout(request.startTimer);
    }

    switch (kind) {
      case 'text': {
        if (event.role !== 'assistant' || typeof event.content !== 'string' || !event.content.trim()) break;
        const id = typeof event.id === 'string' ? event.id : `${now}`;
        if (record.texts.some((row) => row.id === id)) break;
        record.texts.push({ id, at: now, text: event.content.trim().slice(0, TEXT_MAX_CHARS) });
        if (record.texts.length > TEXTS_KEPT) record.texts.shift();
        break;
      }
      case 'stream_delta':
        if (typeof event.content === 'string') record.openStream = (record.openStream + event.content).slice(-TEXT_MAX_CHARS);
        break;
      case 'stream_end':
        if (record.openStream.trim()) {
          record.streams.push({ at: now, text: record.openStream.trim() });
          if (record.streams.length > TEXTS_KEPT) record.streams.shift();
        }
        record.openStream = '';
        break;
      case 'permission_request':
        noteWaiting(sessionId, event);
        break;
      case 'permission_resolved':
      case 'permission_cancelled':
        if (typeof event.requestId === 'string') record.waiting.delete(event.requestId);
        break;
      case 'complete':
        record.waiting.clear();
        record.openStream = '';
        record.completedAt = now;
        if (request?.sawFrame) {
          finishTurn(sessionId, request, event.success !== false, Boolean(event.aborted));
          // The rows were this request's reply. Dropping them keeps the next request from picking them up when it starts in the same millisecond.
          record.texts = [];
          record.streams = [];
        }
        break;
      default:
        break;
    }
  };

  return {
    handleEvent,

    async askSession(sessionId, request) {
      const target = deps.getTarget();
      const text = `${VOICE_MESSAGE_PREFIX}${request}`;

      // A new chat has no id yet: send through its composer and let the id arrive afterwards.
      if (sessionId === undefined && target && target.sessionId === null) {
        if (pending.has(null)) throw new Error('The new chat already has a voice request running.');
        const reply = startRequest(null, target.sessionName ?? 'the new chat');
        target.submitText(text);
        return reply;
      }

      const id = sessionId ?? target?.sessionId;
      if (!id) throw new Error('No chat is open on screen.');
      const entry = entryFor(id) ?? {
        id,
        name: target?.sessionId === id ? target.sessionName ?? 'this session' : 'the voice session',
        projectName: target?.sessionId === id ? target.projectName ?? '' : '',
      };
      if (pending.has(id)) throw new Error(`'${entry.name}' already has a voice request running. Wait for its reply.`);
      const status = statusOf(id);
      if (status !== 'idle') {
        throw new Error(status === 'running'
          ? `'${entry.name}' is busy working on something. Try again when it finishes.`
          : `'${entry.name}' is ${status}. Jason has to answer there first.`);
      }

      const reply = startRequest(id, entry.name);
      if (target?.sessionId === id) {
        target.submitText(text);
      } else {
        deps.send({ type: 'chat.send', sessionId: id, content: text, options: deps.buildSendOptions(entry) });
        deps.getDirectory()?.markSessionProcessing(id);
      }
      return reply;
    },

    bindNewSession(sessionId) {
      const request = pending.get(null);
      if (!request) return;
      pending.delete(null);
      request.sessionId = sessionId;
      pending.set(sessionId, request);
      const record = recordFor(sessionId);
      // Frames that came before the id was known are already in the record.
      if (record.lastFrameAt >= request.startedAt) {
        request.sawFrame = true;
        clearTimeout(request.startTimer);
        if (record.completedAt >= request.startedAt) finishTurn(sessionId, request, true, false);
      }
    },

    dispose(reason) {
      for (const key of [...pending.keys()]) settle(key, { error: new Error(reason) });
    },
  };
}
