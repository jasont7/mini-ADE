/** The one tool Gemini has: sends a request to the voice session's Claude and returns the reply. */
export const ASK_CLAUDE_TOOL = 'ask_claude';

/** Audio the browser sends to Gemini: 16 kHz mono PCM. */
export const GEMINI_INPUT_SAMPLE_RATE = 16_000;

/** Audio Gemini returns: 24 kHz mono PCM. */
export const GEMINI_OUTPUT_SAMPLE_RATE = 24_000;

const LIVE_SOCKET_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

/** Persona and spoken rules for the voice front of one voice session. Kept short on purpose. */
export const GEMINI_VOICE_PROMPT = [
  "You are the voice for one of Jason's mini-ADE sessions, where a Claude does the real work. You talk with him out loud while it works.",
  'Speak in short plain sentences, usually one to four. Never read out markdown, code, file paths or URLs.',
  'Chat on your own for small talk and simple questions. For anything real, such as looking at files, writing, running or changing things, or anything about his project, use the ask_claude tool instead of guessing.',
  `${ASK_CLAUDE_TOOL} sends his request to the session's Claude and returns its reply when its turn ends. Say one short line such as "On it." before you call it, and keep chatting if he talks while it works.`,
  'Never say something is done before a tool result tells you it is. When a result arrives, say it in your own short words.',
  'If the tool says Claude is busy or waiting for permission or an answer, tell him so and do not retry.',
  'Short notes that start with "Context:" are background. Read them silently and do not repeat them.',
].join(' ');

/** One tool call requested by the model. */
export type GeminiToolCall = { id: string; name: string; args: Record<string, unknown> };

/** A server message reduced to the cases the live hook acts on. */
export type GeminiServerEvent =
  | { kind: 'setupComplete' }
  | { kind: 'audio'; data: string }
  | { kind: 'interrupted' }
  | { kind: 'turnComplete' }
  | { kind: 'toolCall'; calls: GeminiToolCall[] }
  | { kind: 'toolCancel'; ids: string[] }
  | { kind: 'resumption'; handle: string | null; resumable: boolean }
  | { kind: 'goAway'; timeLeftMs: number }
  | { kind: 'inputTranscript'; text: string }
  | { kind: 'outputTranscript'; text: string };

type SetupOptions = {
  model: string;
  voice: string | null;
  resumptionHandle: string | null;
  nonBlockingTools: boolean;
};

/** Browser WebSocket URL for one connection, authenticated with an ephemeral token. */
export function buildLiveSocketUrl(token: string): string {
  return `${LIVE_SOCKET_BASE}?access_token=${encodeURIComponent(token)}`;
}

/** Function declaration of `ask_claude`. `NON_BLOCKING` lets the model keep talking while Claude works. */
export function buildToolDeclarations(nonBlocking: boolean): Record<string, unknown>[] {
  return [
    {
      name: ASK_CLAUDE_TOOL,
      description: "Send a request to this session's Claude and return its reply when its turn ends. Refused if Claude is already busy.",
      parameters: {
        type: 'OBJECT',
        properties: {
          request: { type: 'STRING', description: 'What Claude should do, in plain words.' },
        },
        required: ['request'],
      },
      ...(nonBlocking ? { behavior: 'NON_BLOCKING' } : {}),
    },
  ];
}

/**
 * First message of a Live connection: model, voice, the voice persona, the
 * `ask_claude` tool, sliding window compression and session resumption (with the
 * saved handle when this is a reconnect). Non-blocking behaviour is only
 * declared for models that support it.
 */
export function buildSetupMessage(options: SetupOptions): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = { responseModalities: ['AUDIO'] };
  if (options.voice) {
    generationConfig.speechConfig = {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voice } },
    };
  }

  return {
    setup: {
      model: options.model.startsWith('models/') ? options.model : `models/${options.model}`,
      generationConfig,
      systemInstruction: { parts: [{ text: GEMINI_VOICE_PROMPT }] },
      tools: [{ functionDeclarations: buildToolDeclarations(options.nonBlockingTools) }],
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: options.resumptionHandle ? { handle: options.resumptionHandle } : {},
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

/** One microphone chunk (base64 16 kHz PCM) for the realtime input stream. */
export function buildAudioMessage(base64Pcm: string): Record<string, unknown> {
  return { realtimeInput: { audio: { data: base64Pcm, mimeType: `audio/pcm;rate=${GEMINI_INPUT_SAMPLE_RATE}` } } };
}

/**
 * A plain-text turn. With `speak` false it only adds context: the model reads
 * it but stays quiet until the user speaks. With `speak` true the model
 * answers it. Used for the recap that a continued voice session starts with.
 */
export function buildContextMessage(text: string, speak: boolean): Record<string, unknown> {
  return { clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: speak } };
}

/**
 * The reply to a tool call. `scheduling` only applies to non-blocking tools:
 * WHEN_IDLE lets the front finish its sentence before announcing the result.
 */
export function buildToolResponse(
  call: Pick<GeminiToolCall, 'id' | 'name'>,
  output: string,
  scheduling: 'WHEN_IDLE' | null,
): Record<string, unknown> {
  const response: Record<string, unknown> = { id: call.id, name: call.name, response: { output } };
  if (scheduling) response.scheduling = scheduling;
  return { toolResponse: { functionResponses: [response] } };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseDurationMs(value: unknown): number {
  // Google sends durations as strings such as "50s" or "1.5s".
  if (typeof value === 'string') {
    const seconds = Number.parseFloat(value);
    return Number.isFinite(seconds) ? seconds * 1000 : 0;
  }
  return 0;
}

/**
 * Reduces one decoded server message to the events the hook acts on. A single
 * message can carry several (audio parts plus turnComplete), so it returns a
 * list. Unknown shapes are ignored rather than thrown on.
 */
export function parseServerMessage(raw: unknown): GeminiServerEvent[] {
  const message = asRecord(raw);
  if (!message) return [];
  const events: GeminiServerEvent[] = [];

  if (message.setupComplete !== undefined) events.push({ kind: 'setupComplete' });

  const content = asRecord(message.serverContent);
  if (content) {
    if (content.interrupted === true) events.push({ kind: 'interrupted' });
    const parts = asRecord(content.modelTurn)?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const inline = asRecord(asRecord(part)?.inlineData);
        if (inline && typeof inline.data === 'string') events.push({ kind: 'audio', data: inline.data });
      }
    }
    const inputText = asRecord(content.inputTranscription)?.text;
    if (typeof inputText === 'string') events.push({ kind: 'inputTranscript', text: inputText });
    const outputText = asRecord(content.outputTranscription)?.text;
    if (typeof outputText === 'string') events.push({ kind: 'outputTranscript', text: outputText });
    if (content.turnComplete === true) events.push({ kind: 'turnComplete' });
  }

  const toolCall = asRecord(message.toolCall);
  if (toolCall && Array.isArray(toolCall.functionCalls)) {
    const calls: GeminiToolCall[] = [];
    for (const item of toolCall.functionCalls) {
      const call = asRecord(item);
      if (call && typeof call.id === 'string' && typeof call.name === 'string') {
        calls.push({ id: call.id, name: call.name, args: asRecord(call.args) ?? {} });
      }
    }
    if (calls.length > 0) events.push({ kind: 'toolCall', calls });
  }

  const cancellation = asRecord(message.toolCallCancellation);
  if (cancellation && Array.isArray(cancellation.ids)) {
    events.push({ kind: 'toolCancel', ids: cancellation.ids.filter((id): id is string => typeof id === 'string') });
  }

  const update = asRecord(message.sessionResumptionUpdate);
  if (update) {
    events.push({
      kind: 'resumption',
      handle: typeof update.newHandle === 'string' ? update.newHandle : null,
      resumable: update.resumable !== false,
    });
  }

  const goAway = asRecord(message.goAway);
  if (goAway) events.push({ kind: 'goAway', timeLeftMs: parseDurationMs(goAway.timeLeft) });

  return events;
}

/** Remembers the latest resumption handle so a dropped or expiring connection continues the same conversation. */
export type ResumptionTracker = {
  apply(event: GeminiServerEvent): void;
  handle(): string | null;
};

/** Creates the tracker used by the Gemini live hook. A non-resumable update clears the handle, as Google asks. */
export function createResumptionTracker(): ResumptionTracker {
  let current: string | null = null;
  return {
    apply(event) {
      if (event.kind !== 'resumption') return;
      current = event.resumable && event.handle ? event.handle : null;
    },
    handle: () => current,
  };
}
