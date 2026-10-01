import assert from 'node:assert/strict';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderHook } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

// Initializes i18next with the real locales, so the labels below are the shipped strings.
import '@/modules/i18n';
import BackgroundTasksIndicator from '@/modules/chat/composer/BackgroundTasksIndicator';
import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { BackgroundTask, ProjectSession, ServerEvent } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * A turn can end while a backgrounded shell, agent or Monitor keeps running.
 * The composer unlocks, so the server's task list is what tells the user work
 * is still going on. It must reach the composer, never the transcript.
 */

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const reported: Array<[string, BackgroundTask[]]> = [];
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
    onBackgroundTasks: (sessionId, tasks) => { reported.push([sessionId, tasks]); },
    requestLatestMessages: async () => {},
    sessionStore: {
      appendRealtime: (_sessionId: string, message: unknown) => { appended.push(message); },
    } as unknown as SessionStore,
  }));

  const dispatch = (event: ServerEvent) => listener?.(event);
  return { reported, appended, dispatch };
};

const shell: BackgroundTask = { id: 'bzhkf5nl6', description: 'sleep 25 && echo finished' };

test('a background_tasks event updates the session list and stays out of the transcript', () => {
  const { reported, appended, dispatch } = renderHandlers();

  dispatch({ kind: 'background_tasks', sessionId: 'viewed-session', backgroundTasks: [shell] } as unknown as ServerEvent);
  dispatch({ kind: 'background_tasks', sessionId: 'viewed-session', backgroundTasks: [] } as unknown as ServerEvent);

  assert.deepEqual(reported, [['viewed-session', [shell]], ['viewed-session', []]]);
  assert.equal(appended.length, 0);
});

test('opening a session restores its running tasks from the subscribe ack', () => {
  const { reported, dispatch } = renderHandlers();

  dispatch({
    kind: 'chat_subscribed',
    sessionId: 'other-session',
    isProcessing: false,
    pendingPermissions: [],
    backgroundTasks: [shell],
  } as unknown as ServerEvent);

  assert.deepEqual(reported, [['other-session', [shell]]]);
});

test('the tab names a single task and counts several', () => {
  const one = renderToStaticMarkup(React.createElement(BackgroundTasksIndicator, { tasks: [shell] }));
  assert.match(one, /Background: sleep 25 &amp;&amp; echo finished/);

  const many = renderToStaticMarkup(React.createElement(BackgroundTasksIndicator, {
    tasks: [shell, { id: 'm1', description: 'Narval Makefile' }],
  }));
  assert.match(many, /2 background tasks running/);
  assert.match(many, /Narval Makefile/);

  assert.equal(renderToStaticMarkup(React.createElement(BackgroundTasksIndicator, { tasks: [] })), '');
});

afterEach(() => {
  vi.useRealTimers();
});

test('the tab shows how long the oldest task has run', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-30T18:00:00.000Z'));
  const now = Date.now();

  const seconds = renderToStaticMarkup(React.createElement(BackgroundTasksIndicator, {
    tasks: [{ ...shell, startedAt: now - 42_000 }],
  }));
  assert.match(seconds, />42s</);

  const minutes = renderToStaticMarkup(React.createElement(BackgroundTasksIndicator, {
    tasks: [{ ...shell, startedAt: now - 125_000 }, { id: 'm1', description: 'Narval Makefile', startedAt: now - 5_000 }],
  }));
  assert.match(minutes, />2m 5s</);
  assert.match(minutes, /Narval Makefile \(5s\)/);

  const hours = renderToStaticMarkup(React.createElement(BackgroundTasksIndicator, {
    tasks: [{ ...shell, startedAt: now - (2 * 3600 + 7 * 60 + 30) * 1000 }],
  }));
  assert.match(hours, />2h 7m</);
});
