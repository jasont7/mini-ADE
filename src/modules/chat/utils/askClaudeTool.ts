import { toSpeakableText } from '@/modules/chat/utils/speakableText';
import { ASK_CLAUDE_TOOL } from '@/modules/chat/utils/geminiLiveProtocol';
import type { GeminiToolCall } from '@/modules/chat/utils/geminiLiveProtocol';

/** A finished tool call ready to be sent back to the model. */
export type ToolCallResult = {
  call: GeminiToolCall;
  output: string;
  /** Non-null only for non-blocking tools, so the front announces the result when idle. */
  scheduling: 'WHEN_IDLE' | null;
};

type ToolRunDependencies = {
  /** Sends the request into the voice session and resolves with Claude's reply. */
  askClaude(request: string): Promise<string>;
  nonBlockingTools: boolean;
  /** Called once per finished call, unless the call was cancelled meanwhile. */
  respond(result: ToolCallResult): void;
  isCancelled(callId: string): boolean;
  /** Called with true when a request starts waiting on Claude and false when it ends. Calls may overlap, so count them. */
  onBusyChange(busy: boolean): void;
  /** Called with a short one-line note when a request goes out and when its reply (or failure) comes back, for the saved transcript. */
  onNote(text: string): void;
};

const NOTE_REQUEST_MAX_CHARS = 200;
const NOTE_REPLY_MAX_CHARS = 400;

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

async function runOne(call: GeminiToolCall, deps: ToolRunDependencies): Promise<string> {
  if (call.name !== ASK_CLAUDE_TOOL) return `Unknown tool ${call.name}.`;
  const request = readString(call.args.request);
  if (!request) return 'The request was empty.';
  deps.onNote(`Asked Claude: ${oneLine(request, NOTE_REQUEST_MAX_CHARS)}`);
  deps.onBusyChange(true);
  try {
    const reply = toSpeakableText(await deps.askClaude(request), 1200) || 'Claude finished but had nothing to say.';
    deps.onNote(`Claude replied: ${oneLine(reply, NOTE_REPLY_MAX_CHARS)}`);
    return reply;
  } catch (error) {
    deps.onNote(`Claude did not answer: ${oneLine(error instanceof Error ? error.message : 'that did not work', NOTE_REPLY_MAX_CHARS)}`);
    throw error;
  } finally {
    deps.onBusyChange(false);
  }
}

/**
 * Runs the model's tool calls. A failure, such as Claude being busy, becomes a
 * sentence the model can say, so a problem never wedges the conversation.
 * Calls run at once, and unknown tools get an error reply. Used by the Gemini
 * live hook.
 */
export async function runToolCalls(calls: GeminiToolCall[], deps: ToolRunDependencies): Promise<void> {
  const scheduling = deps.nonBlockingTools ? 'WHEN_IDLE' : null;

  await Promise.all(calls.map(async (call) => {
    let output: string;
    try {
      output = await runOne(call, deps);
    } catch (error) {
      output = error instanceof Error && error.message ? error.message : 'That did not work.';
    }
    if (!deps.isCancelled(call.id)) deps.respond({ call, output, scheduling });
  }));
}
