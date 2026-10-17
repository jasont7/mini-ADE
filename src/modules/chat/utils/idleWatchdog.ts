/** Tracks silence so a Gemini session can be ended after the idle limit. */
export type IdleWatchdog = {
  /** Records activity: the user speaking, the model speaking, or any live exchange. */
  touch(now: number): void;
  /** While true (Claude is working on a request) the session is never idle. */
  setBusy(busy: boolean, now: number): void;
  isExpired(now: number): boolean;
};

/** Cost safety limit: a Gemini session ends after two minutes of silence. */
export const GEMINI_IDLE_TIMEOUT_MS = 120_000;

/**
 * Creates the idle watchdog used by the Gemini live hook. It is clock free:
 * the caller passes timestamps, which keeps it deterministic in tests.
 */
export function createIdleWatchdog(timeoutMs: number, startedAt: number): IdleWatchdog {
  let lastActivity = startedAt;
  let busy = false;

  return {
    touch(now) {
      lastActivity = now;
    },
    setBusy(value, now) {
      busy = value;
      // Leaving the busy state counts as activity so the full timeout starts fresh.
      if (!value) lastActivity = now;
    },
    isExpired(now) {
      return !busy && now - lastActivity >= timeoutMs;
    },
  };
}
