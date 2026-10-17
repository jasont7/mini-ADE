import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Project, SessionViewState } from '@/shared/types';
import { summarizeProjectActivity, triageSessions } from '@/modules/sidebar/utils/sessionTriage';

// Local noon, so "today" and "past week" do not depend on the runner's zone.
const NOW = new Date(2026, 9, 1, 12, 0, 0);
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3600_000).toISOString();

const makeProject = (projectId: string, displayName: string, sessions: Project['sessions']): Project => ({
  projectId,
  displayName,
  fullPath: `/work/${displayName}`,
  sessions,
});

const alpha = makeProject('p-alpha', 'alpha', [
  { id: 'a-running', summary: 'Refactor auth', lastActivity: hoursAgo(1) },
  {
    id: 'a-unread',
    summary: 'Fix flaky test',
    lastActivity: hoursAgo(2),
    lastCompletedAt: hoursAgo(2),
    lastViewedAt: hoursAgo(3),
  },
  { id: 'a-today', summary: 'Write docs', lastActivity: hoursAgo(1) },
  { id: 'a-week', summary: 'Plan release', lastActivity: hoursAgo(24 * 3) },
  { id: 'a-old', summary: 'Spike', lastActivity: hoursAgo(24 * 30) },
]);

const beta = makeProject('p-beta', 'beta', [
  { id: 'b-today', summary: 'Ship landing page', lastActivity: hoursAgo(4) },
]);

const baseInputs = {
  projects: [alpha, beta],
  scopeProjectId: null,
  query: '',
  nowMs: NOW.getTime(),
  activeSessions: new Set(['a-running']) as ReadonlySet<string>,
  sessionViewStates: new Map<string, SessionViewState>() as ReadonlyMap<string, SessionViewState>,
  selectedSessionId: null,
};

const idsByGroup = (groups: ReturnType<typeof triageSessions>) =>
  Object.fromEntries(groups.map((group) => [group.key, group.sessions.map((entry) => entry.session.id)]));

test('files sessions under attention first, then recency, across projects', () => {
  assert.deepEqual(idsByGroup(triageSessions(baseInputs)), {
    review: ['a-unread'],
    running: ['a-running'],
    today: ['a-today', 'b-today'],
    week: ['a-week'],
    older: ['a-old'],
  });
});

test('a project scope lists only that project and drops empty groups', () => {
  const groups = triageSessions({ ...baseInputs, scopeProjectId: 'p-beta' });
  assert.deepEqual(idsByGroup(groups), { today: ['b-today'] });
});

test('the open session is never "to review", since it is on screen', () => {
  const groups = triageSessions({ ...baseInputs, selectedSessionId: 'a-unread' });
  assert.equal(idsByGroup(groups).review, undefined);
  assert.ok(idsByGroup(groups).today.includes('a-unread'));
});

test('a live view-state push overrides a stale unread payload', () => {
  const sessionViewStates = new Map<string, SessionViewState>([
    ['a-unread', { lastViewedAt: hoursAgo(0.5), lastCompletedAt: hoursAgo(2) }],
  ]);
  const groups = triageSessions({ ...baseInputs, sessionViewStates });
  assert.equal(idsByGroup(groups).review, undefined);
});

test('in the all-projects scope a query matches project names too', () => {
  const byProject = triageSessions({ ...baseInputs, query: 'BETA' });
  assert.deepEqual(idsByGroup(byProject), { today: ['b-today'] });

  const byTitle = triageSessions({ ...baseInputs, query: 'flaky' });
  assert.deepEqual(idsByGroup(byTitle), { review: ['a-unread'] });

  // Inside a project the name is implied, so it is not a match on its own.
  const scoped = triageSessions({ ...baseInputs, scopeProjectId: 'p-beta', query: 'beta' });
  assert.deepEqual(scoped, []);
});

test('summarizes running and unread counts per project for the rail', () => {
  const summaries = summarizeProjectActivity([alpha, beta], baseInputs);
  assert.deepEqual(summaries.get('p-alpha'), { running: 1, unread: 1 });
  assert.deepEqual(summaries.get('p-beta'), { running: 0, unread: 0 });
});
