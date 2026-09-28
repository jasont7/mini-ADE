import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { ServerEvent, ProjectSession } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * Sidebar events carry the session id they describe, but they are not
 * transcript rows. `session_view_state` once fell through to the store as a
 * row without an `id`, and every later merge for that session threw: the
 * transcript showed the empty state and sends failed until a reload.
 */

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const appended: unknown[] = [];

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: 'viewed-session' } as ProjectSession,
    currentSessionId: 'viewed-session',
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: null },
    accumulatedStreamRef: { current: '' },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    requestLatestMessages: async () => {},
    sessionStore: {
      appendRealtime: (_sessionId: string, message: unknown) => { appended.push(message); },
    } as unknown as SessionStore,
  }));

  const dispatch = (event: ServerEvent) => listener?.(event);
  return { appended, dispatch };
};

for (const kind of ['session_view_state', 'session_upserted', 'loading_progress']) {
  test(`${kind} is not stored as a transcript row`, () => {
    const { appended, dispatch } = renderHandlers();

    dispatch({
      kind,
      sessionId: 'viewed-session',
      lastViewedAt: '2026-09-28 21:40:00',
      lastCompletedAt: '2026-09-28 21:39:00',
    } as unknown as ServerEvent);

    assert.equal(appended.length, 0);
  });
}
