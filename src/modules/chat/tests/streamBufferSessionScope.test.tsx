import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { test, vi } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { NormalizedMessage, ProjectSession, ServerEvent } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * Every chat on screen hears every session's events. The stream buffer used to
 * take `stream_delta` text from any session, so two sessions streaming at once
 * (a background run, or the two panes of split view) wrote a blend of both
 * replies into the viewed one. Only the viewed session's text may enter it.
 */

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const accumulatedStreamRef = { current: '' };
  const appended: Array<{ sessionId: string; msg: NormalizedMessage }> = [];
  const finalized: string[] = [];
  const store = {
    appendRealtime: (sessionId: string, msg: NormalizedMessage) => appended.push({ sessionId, msg }),
    updateStreaming: vi.fn(),
    finalizeStreaming: (sessionId: string) => finalized.push(sessionId),
  } as unknown as SessionStore;

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
    accumulatedStreamRef,
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    requestLatestMessages: async () => {},
    sessionStore: store,
  }));

  const emit = (event: Record<string, unknown>) => listener?.(event as ServerEvent);
  return { emit, accumulatedStreamRef, appended, finalized };
};

test('another session\'s deltas stay out of the viewed session\'s stream buffer', () => {
  const { emit, accumulatedStreamRef, appended } = renderHandlers();

  emit({ kind: 'stream_delta', sessionId: 'viewed-session', content: 'mine ' });
  emit({ kind: 'stream_delta', sessionId: 'other-session', content: 'theirs ' });
  emit({ kind: 'stream_delta', sessionId: 'viewed-session', content: 'again' });

  assert.equal(accumulatedStreamRef.current, 'mine again');
  assert.deepEqual(
    appended.map(({ sessionId, msg }) => [sessionId, msg.content]),
    [['other-session', 'theirs ']],
  );
});

test('another session ending its stream leaves the viewed buffer alone', () => {
  const { emit, accumulatedStreamRef, finalized } = renderHandlers();

  emit({ kind: 'stream_delta', sessionId: 'viewed-session', content: 'half a reply' });
  emit({ kind: 'stream_end', sessionId: 'other-session' });
  emit({ kind: 'complete', sessionId: 'other-session' });

  assert.equal(accumulatedStreamRef.current, 'half a reply');
  assert.deepEqual(finalized, ['other-session']);
});
