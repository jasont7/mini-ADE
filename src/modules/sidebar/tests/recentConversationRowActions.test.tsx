import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import type { ActiveSidebarRename, RecentConversationListItem, SessionRowActions, SidebarProjectListProps } from '@/shared/types';

/**
 * The Conversations list renders the same controls as the Projects list, from
 * the same component. These tests assert what the row resolves for it — which
 * session, which project, and the two states that change the row's appearance —
 * by capturing the props of a stubbed SessionOptions, the way
 * sidebarRowProps.test.tsx captures the row props.
 */

const recordedOptionsProps: Record<string, unknown>[] = [];

vi.mock('@/modules/sidebar/SessionOptions', () => ({
  default: (props: Record<string, unknown>) => {
    recordedOptionsProps.push(props);
    return null;
  },
}));

const { default: SidebarRecentConversations } = await import('@/modules/sidebar/SidebarRecentConversations');

const t = ((key: string) => key) as unknown as SidebarProjectListProps['t'];
const NOW = new Date('2026-08-21T10:00:00.000Z');
const noop = () => {};

const conversation = (
  sessionId: string,
  overrides: Partial<RecentConversationListItem> = {},
): RecentConversationListItem => ({
  sessionId,
  provider: 'claude',
  projectId: 'project-1',
  projectDisplayName: 'project one',
  sessionTitle: `title of ${sessionId}`,
  lastActivity: '2026-08-21T09:30:00.000Z',
  ...overrides,
});

const makeActions = (overrides: Partial<SessionRowActions> = {}): SessionRowActions => ({
  activeRename: null,
  activeSessions: new Set<string>(),
  sessionViewStates: new Map(),
  onRenameDraftChange: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  onDeleteSession: noop,
  ...overrides,
});

const renderList = (
  conversations: RecentConversationListItem[],
  sessionActions: SessionRowActions,
) => render(
  <SidebarRecentConversations
    conversations={conversations}
    total={conversations.length}
    hasMore={false}
    isLoading={false}
    isLoadingMore={false}
    hasError={false}
    selectedSession={null}
    currentTime={NOW}
    sessionActions={sessionActions}
    onConversationSelect={noop}
    onLoadMore={noop}
    onRetry={noop}
    t={t}
  />,
);

beforeEach(() => {
  recordedOptionsProps.length = 0;
});

test('every conversation row gets the shared session controls', () => {
  renderList([conversation('s1'), conversation('s2')], makeActions());

  assert.equal(recordedOptionsProps.length, 2);
  assert.equal(recordedOptionsProps[0].sessionId, 's1');
  assert.equal(recordedOptionsProps[0].sessionName, 'title of s1');
  assert.equal(recordedOptionsProps[0].provider, 'claude');
  assert.equal(recordedOptionsProps[0].projectId, 'project-1');
});

test('a conversation with no known project still renders, and says so', () => {
  renderList([conversation('s1', { projectId: null })], makeActions());

  // SessionOptions withholds rename on a null projectId rather than guessing one.
  assert.equal(recordedOptionsProps.length, 1);
  assert.equal(recordedOptionsProps[0].projectId, null);
});

test('the rename open elsewhere does not put this row into editing', () => {
  const activeRename: ActiveSidebarRename = {
    target: 'session',
    id: 's2',
    projectId: 'project-1',
    draft: 'a new name',
  };
  renderList([conversation('s1'), conversation('s2')], makeActions({ activeRename }));

  assert.equal(recordedOptionsProps[0].isEditing, false);
  assert.equal(recordedOptionsProps[0].renameDraft, '');
  assert.equal(recordedOptionsProps[1].isEditing, true);
  assert.equal(recordedOptionsProps[1].renameDraft, 'a new name');
});

test('a project rename never puts a session row into editing', () => {
  const activeRename: ActiveSidebarRename = { target: 'project', id: 's1', draft: 'x' };
  renderList([conversation('s1')], makeActions({ activeRename }));

  assert.equal(recordedOptionsProps[0].isEditing, false);
});

test('a running session is marked processing and shows a spinner instead of its age', () => {
  const { container } = renderList(
    [conversation('s1'), conversation('s2')],
    makeActions({ activeSessions: new Set(['s1']) }),
  );

  assert.equal(recordedOptionsProps[0].isProcessing, true);
  assert.equal(recordedOptionsProps[1].isProcessing, false);
  assert.equal(container.querySelectorAll('.animate-spin').length, 1);
  assert.equal(container.querySelectorAll('time').length, 1);
});

test('a response that finished after the last view gets the green dot', () => {
  const { container } = renderList(
    [
      conversation('read', { lastCompletedAt: '2026-08-21T09:00:00.000Z', lastViewedAt: '2026-08-21T09:05:00.000Z' }),
      conversation('unread', { lastCompletedAt: '2026-08-21T09:10:00.000Z', lastViewedAt: '2026-08-21T09:05:00.000Z' }),
      conversation('never-ran'),
    ],
    makeActions(),
  );

  const dots = container.querySelectorAll('[role="status"].bg-green-500');
  assert.equal(dots.length, 1);
  assert.equal(dots[0].closest('.group')?.querySelector('a')?.getAttribute('href'), '/session/unread');
});

test('a view pushed by another device clears the dot without a reload', () => {
  const unread = conversation('s1', {
    lastCompletedAt: '2026-08-21T09:10:00.000Z',
    lastViewedAt: '2026-08-21T09:05:00.000Z',
  });

  const { container } = renderList(
    [unread],
    makeActions({
      sessionViewStates: new Map([['s1', { lastViewedAt: '2026-08-21T09:20:00.000Z', lastCompletedAt: '2026-08-21T09:10:00.000Z' }]]),
    }),
  );

  assert.equal(container.querySelectorAll('[role="status"].bg-green-500').length, 0);
});

test('a session nobody has touched for a day is greyed out', () => {
  const dayAndAMinuteAgo = new Date(NOW.getTime() - 24 * 60 * 60 * 1000 - 60 * 1000).toISOString();
  const { container } = renderList(
    [
      conversation('recent'),
      conversation('stale', { lastActivity: dayAndAMinuteAgo }),
      conversation('viewed', { lastActivity: dayAndAMinuteAgo, lastViewedAt: new Date(NOW.getTime() - 60 * 1000).toISOString() }),
    ],
    makeActions(),
  );

  const rows = [...container.querySelectorAll('[data-testid="recent-conversation-row"]')];
  const greyed = rows.map((row) => row.parentElement?.classList.contains('opacity-50'));
  assert.deepEqual(greyed, [false, true, false]);
});
