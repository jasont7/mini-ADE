import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { readUserPreference, subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';

const NO_ORDER: readonly string[] = [];

const readStoredOrder = (): unknown => readUserPreference<unknown>('projectOrder', null);

/**
 * The rail order the user arranged by dragging, as project ids, and a setter.
 * Backed by the synced preference store, so the desktop and the phone share
 * one arrangement.
 */
export function useProjectOrder() {
  // A stable snapshot: the store returns the same array until it changes.
  const stored = useSyncExternalStore(subscribeToUserPreferences, readStoredOrder);
  const order = useMemo<readonly string[]>(
    () => (Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : NO_ORDER),
    [stored],
  );

  const setProjectOrder = useCallback((next: string[]) => {
    writeUserPreference('projectOrder', next);
  }, []);

  return { order, setProjectOrder };
}
