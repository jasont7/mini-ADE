import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useSplitViewState } from '@/modules/project-workspace/hooks/useSplitViewState';
import type { SplitPaneTarget } from '@/shared/types';

/**
 * Split view puts a second chat beside the URL-bound one on wide screens. The
 * state decides where sidebar picks land, keeps one conversation out of two
 * panes, and must survive a reload and a window that shrinks below the
 * breakpoint without losing either session.
 */

type Props = {
  isWide: boolean;
  primary: SplitPaneTarget;
};

const PRIMARY: SplitPaneTarget = { sessionId: 'left-session', projectId: 'project-a' };

const renderSplit = (initial: Partial<Props> = {}) => {
  const onPrimaryTakeover = vi.fn();
  const hook = renderHook(
    (props: Props) => useSplitViewState({ ...props, onPrimaryTakeover }),
    { initialProps: { isWide: true, primary: PRIMARY, ...initial } },
  );
  return { ...hook, onPrimaryTakeover };
};

const readStored = () => JSON.parse(localStorage.getItem('split-view') ?? 'null');

beforeEach(() => {
  localStorage.clear();
});

test('starts closed, with the left pane focused', () => {
  const { result } = renderSplit();

  assert.equal(result.current.isSplitActive, false);
  assert.equal(result.current.focusedPane, 'primary');
  assert.equal(result.current.dividerRatio, 0.5);
});

test('opening the split puts a new chat in the left pane\'s project on the right and focuses it', () => {
  const { result } = renderSplit();

  act(() => result.current.openSplit());

  assert.equal(result.current.isSplitActive, true);
  assert.deepEqual(result.current.secondary, { sessionId: null, projectId: 'project-a' });
  assert.equal(result.current.focusedPane, 'secondary');
  assert.equal(result.current.secondaryNewSessionTrigger, 1);
});

test('closing the split returns focus to the left pane', () => {
  const { result } = renderSplit();

  act(() => result.current.openSplit({ sessionId: 'right-session', projectId: 'project-b' }));
  act(() => result.current.closeSplit());

  assert.equal(result.current.isSplitActive, false);
  assert.equal(result.current.focusedPane, 'primary');
});

test('split view is never active below the breakpoint', () => {
  const { result } = renderSplit({ isWide: false });

  act(() => result.current.openSplit({ sessionId: 'right-session', projectId: 'project-b' }));

  assert.equal(result.current.isSplitAvailable, false);
  assert.equal(result.current.isSplitActive, false);
  assert.equal(result.current.focusedPane, 'primary');
});

test('a sidebar pick opens in the focused pane', () => {
  const { result } = renderSplit();
  const openInPrimary = vi.fn();

  act(() => result.current.openSplit({ sessionId: 'right-session', projectId: 'project-b' }));
  act(() => result.current.openSession({ sessionId: 'picked', projectId: 'project-c' }, openInPrimary));

  assert.deepEqual(result.current.secondary, { sessionId: 'picked', projectId: 'project-c' });
  assert.equal(openInPrimary.mock.calls.length, 0);

  act(() => result.current.focusPane('primary'));
  act(() => result.current.openSession({ sessionId: 'another', projectId: 'project-c' }, openInPrimary));

  assert.equal(openInPrimary.mock.calls.length, 1);
  assert.deepEqual(result.current.secondary, { sessionId: 'picked', projectId: 'project-c' });
});

test('without a split every pick goes to the left pane', () => {
  const { result } = renderSplit();
  const openInPrimary = vi.fn();

  act(() => result.current.openSession({ sessionId: 'picked', projectId: 'project-c' }, openInPrimary));

  assert.equal(openInPrimary.mock.calls.length, 1);
});

test('a session already open in one pane is focused there, never opened twice', () => {
  const { result } = renderSplit();
  const openInPrimary = vi.fn();

  act(() => result.current.openSplit({ sessionId: 'right-session', projectId: 'project-b' }));
  act(() => result.current.openSession({ sessionId: 'left-session', projectId: 'project-a' }, openInPrimary));

  assert.equal(result.current.focusedPane, 'primary');
  assert.equal(result.current.secondary.sessionId, 'right-session');
  assert.equal(openInPrimary.mock.calls.length, 0);

  act(() => result.current.openSession({ sessionId: 'right-session', projectId: 'project-b' }, openInPrimary));

  assert.equal(result.current.focusedPane, 'secondary');
  assert.equal(openInPrimary.mock.calls.length, 0);
});

test('"Open in split view" on the left pane\'s own session does not duplicate it', () => {
  const { result } = renderSplit();

  act(() => result.current.openSplit({ sessionId: 'left-session', projectId: 'project-a' }));

  assert.equal(result.current.isSplitActive, false);
  assert.equal(result.current.secondary.sessionId, null);
});

test('the right pane gives up a session the URL moves the left pane onto', () => {
  const { result, rerender } = renderSplit();

  act(() => result.current.openSplit({ sessionId: 'right-session', projectId: 'project-b' }));
  rerender({ isWide: true, primary: { sessionId: 'right-session', projectId: 'project-b' } });

  assert.deepEqual(result.current.secondary, { sessionId: null, projectId: 'project-b' });
  assert.equal(result.current.focusedPane, 'primary');
});

test('a new session from the sidebar starts in the focused pane', () => {
  const { result } = renderSplit();
  const openInPrimary = vi.fn();

  act(() => result.current.openSplit({ sessionId: 'right-session', projectId: 'project-b' }));
  const triggerBefore = result.current.secondaryNewSessionTrigger;
  act(() => result.current.startNewSession('project-c', openInPrimary));

  assert.deepEqual(result.current.secondary, { sessionId: null, projectId: 'project-c' });
  assert.equal(result.current.secondaryNewSessionTrigger, triggerBefore + 1);
  assert.equal(openInPrimary.mock.calls.length, 0);
});

test('the right pane follows its new chat onto the session the server allocated', () => {
  const { result } = renderSplit();

  act(() => result.current.openSplit());
  act(() => result.current.showInSecondary('allocated'));

  assert.deepEqual(result.current.secondary, { sessionId: 'allocated', projectId: 'project-a' });
});

test('deleting the right pane\'s session drops it to a new chat', () => {
  const { result } = renderSplit();

  act(() => result.current.openSplit({ sessionId: 'right-session', projectId: 'project-b' }));
  act(() => result.current.forgetSession('right-session'));

  assert.deepEqual(result.current.secondary, { sessionId: null, projectId: 'project-b' });
});

test('the divider is clamped between a quarter and three quarters', () => {
  const { result } = renderSplit();

  act(() => result.current.setDividerRatio(0.1));
  assert.equal(result.current.dividerRatio, 0.25);

  act(() => result.current.setDividerRatio(0.9));
  assert.equal(result.current.dividerRatio, 0.75);

  act(() => result.current.setDividerRatio(Number.NaN));
  assert.equal(result.current.dividerRatio, 0.5);
});

test('the split, its sessions, focus and divider survive a reload', () => {
  const first = renderSplit();

  act(() => first.result.current.openSplit({ sessionId: 'right-session', projectId: 'project-b' }));
  act(() => first.result.current.setDividerRatio(0.6));

  assert.deepEqual(readStored(), {
    isOpen: true,
    secondary: { sessionId: 'right-session', projectId: 'project-b' },
    focusedPane: 'secondary',
    dividerRatio: 0.6,
  });
  first.unmount();

  const second = renderSplit();

  assert.equal(second.result.current.isSplitActive, true);
  assert.deepEqual(second.result.current.secondary, { sessionId: 'right-session', projectId: 'project-b' });
  assert.equal(second.result.current.focusedPane, 'secondary');
  assert.equal(second.result.current.dividerRatio, 0.6);
});

test('a corrupt stored record falls back to the defaults', () => {
  localStorage.setItem('split-view', '{not json');

  const { result } = renderSplit();

  assert.equal(result.current.isSplitActive, false);
  assert.equal(result.current.dividerRatio, 0.5);
});

test('narrowing the window while the right pane is focused keeps that pane', () => {
  const { result, rerender, onPrimaryTakeover } = renderSplit();

  act(() => result.current.openSplit({ sessionId: 'right-session', projectId: 'project-b' }));
  rerender({ isWide: false, primary: PRIMARY });

  // The right pane's session moves into the single pane...
  assert.deepEqual(onPrimaryTakeover.mock.calls, [[{ sessionId: 'right-session', projectId: 'project-b' }]]);
  // ...and the left pane's session is kept, out of view, for when it widens.
  assert.deepEqual(result.current.secondary, PRIMARY);
  assert.equal(result.current.isSplitActive, false);
  assert.equal(result.current.focusedPane, 'primary');

  rerender({ isWide: true, primary: { sessionId: 'right-session', projectId: 'project-b' } });

  assert.equal(result.current.isSplitActive, true);
  assert.deepEqual(result.current.secondary, PRIMARY);
});

test('narrowing the window while the left pane is focused changes nothing but visibility', () => {
  const { result, rerender, onPrimaryTakeover } = renderSplit();

  act(() => result.current.openSplit({ sessionId: 'right-session', projectId: 'project-b' }));
  act(() => result.current.focusPane('primary'));
  rerender({ isWide: false, primary: PRIMARY });

  assert.equal(onPrimaryTakeover.mock.calls.length, 0);
  assert.equal(result.current.isSplitActive, false);

  rerender({ isWide: true, primary: PRIMARY });

  assert.equal(result.current.isSplitActive, true);
  assert.equal(result.current.secondary.sessionId, 'right-session');
});
