import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * Unread and last-viewed state live on the server so every device agrees. The
 * client only keeps what the server pushes as `session_view_state`, and must
 * not treat it as a transcript change.
 */

vi.mock('@/shared/api', () => ({
  api: {
    projects: () => Promise.resolve({ ok: true, json: async (): Promise<Project[]> => [] }),
    projectTaskmaster: () => Promise.resolve({ ok: false }),
    sessionDetails: () => Promise.resolve({ ok: false }),
    projectSessions: () => Promise.resolve({ ok: false }),
  },
}));

type ServerEventListener = (event: { kind: string }) => void;

const listeners = new Set<ServerEventListener>();

const emit = (event: Record<string, unknown>) => {
  listeners.forEach((listener) => listener(event as { kind: string }));
};

const renderProjectsState = async () => {
  const { useProjectsState } = await import(
    '@/modules/project-workspace/hooks/useProjectsState'
  );

  return renderHook(() =>
    useProjectsState({
      sessionId: 'viewed',
      navigate: vi.fn(),
      subscribe: (listener: ServerEventListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      isMobile: false,
      isSessionProcessing: () => false,
    }),
  );
};

beforeEach(() => {
  localStorage.clear();
  listeners.clear();
});

afterEach(() => {
  vi.resetModules();
});

test('a pushed view state is kept for the sidebar rows to read', async () => {
  const { result } = await renderProjectsState();

  await act(async () => {
    emit({
      kind: 'session_view_state',
      sessionId: 'other',
      lastViewedAt: '2026-08-21T09:00:00.000Z',
      lastCompletedAt: '2026-08-21T09:10:00.000Z',
    });
  });

  assert.deepEqual(result.current.sidebarSharedProps.sessionViewStates.get('other'), {
    lastViewedAt: '2026-08-21T09:00:00.000Z',
    lastCompletedAt: '2026-08-21T09:10:00.000Z',
  });
});

test('a view state for the session on screen does not reload its messages', async () => {
  const { result } = await renderProjectsState();
  const before = result.current.externalMessageUpdate;

  await act(async () => {
    emit({
      kind: 'session_view_state',
      sessionId: 'viewed',
      lastViewedAt: '2026-08-21T09:00:00.000Z',
      lastCompletedAt: null,
    });
  });

  assert.equal(result.current.externalMessageUpdate, before);
});
