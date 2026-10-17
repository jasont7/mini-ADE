import { useCallback, useEffect, useState } from 'react';

/**
 * Reports when a wait has gone on longer than `delayMs`.
 *
 * `waitKey` names what is being waited on (a session id). A new key, or a call
 * to `restart`, starts the clock again, so a stall in one session never shows
 * up in the next and a retry gets its own full delay.
 */
export function useStalledWait(isWaiting: boolean, waitKey: string | null, delayMs: number) {
  // Bumped by restart() so a retry of the same key counts as a new wait.
  const [attempt, setAttempt] = useState(0);
  // The wait that outlasted the delay. Set from the timer, never during
  // render, and compared against the current wait so it cannot go stale.
  const [stalledWaitId, setStalledWaitId] = useState<string | null>(null);
  const waitId = `${waitKey ?? ''}:${attempt}`;

  useEffect(() => {
    if (!isWaiting) return;
    const timer = setTimeout(() => setStalledWaitId(waitId), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, isWaiting, waitId]);

  const restart = useCallback(() => setAttempt((previous) => previous + 1), []);

  return { isStalled: isWaiting && stalledWaitId === waitId, restart };
}
