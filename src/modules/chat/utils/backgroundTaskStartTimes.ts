import type { BackgroundTask, ChatMessage } from '@/shared/types';

const toEpochMs = (timestamp: ChatMessage['timestamp']): number | null => {
  const ms = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const resultText = (message: ChatMessage): string => {
  const content = message.toolResult?.content;
  if (typeof content === 'string') return content;
  if (content === undefined || content === null) return '';
  return JSON.stringify(content);
};

/**
 * Finds when each running background task started, from the transcript.
 *
 * The server's task list carries ids and descriptions but no times. Every way
 * a task is launched names its id in the launching tool's result: "Command
 * running in background with ID: …", "moved to the background (ID: …)" for a
 * command that outlived its timeout, "Monitor started (task …)". That tool
 * call's own timestamp is when the work began, and it survives a reload, so a
 * timer built on it does not restart from zero.
 *
 * Scans from the newest message back and stops once every task is matched.
 * Tasks it cannot match (launched by a subagent, say) are left out.
 *
 * Used by chat's ChatInterface to give the composer's background tab a timer.
 */
export function findBackgroundTaskStartTimes(
  messages: readonly ChatMessage[],
  tasks: readonly BackgroundTask[],
): Map<string, number> {
  const startTimes = new Map<string, number>();
  if (tasks.length === 0) return startTimes;

  const unmatched = new Set(tasks.map((task) => task.id));
  for (let index = messages.length - 1; index >= 0 && unmatched.size > 0; index -= 1) {
    const message = messages[index];
    if (!message.isToolUse || !message.toolResult) continue;

    const text = resultText(message);
    if (!text) continue;

    for (const taskId of unmatched) {
      if (!text.includes(taskId)) continue;
      const startedAt = toEpochMs(message.timestamp);
      if (startedAt !== null) {
        startTimes.set(taskId, startedAt);
      }
      unmatched.delete(taskId);
    }
  }
  return startTimes;
}
