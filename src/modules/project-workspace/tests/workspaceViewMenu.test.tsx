import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { test, vi } from 'vitest';

import WorkspaceHeader from '@/modules/project-workspace/WorkspaceHeader';
import type { AppTab, Project } from '@/shared/types';

/**
 * The header used to carry a row of view tabs (Chat, Shell, Files, Source
 * Control, ...) that Jason never used. They now sit behind one menu button at
 * every width. Every destination must still be reachable from it, and the
 * split-view toggle only shows where split view can.
 */

vi.mock('@/modules/plugins', () => ({
  usePlugins: () => ({
    plugins: [{ name: 'notes', displayName: 'Notes', icon: 'notes.svg', enabled: true }],
  }),
  PluginIcon: () => <span data-testid="plugin-icon" />,
}));

const PROJECT = { projectId: 'p1', path: '/p1', fullPath: '/p1', displayName: 'Project One' } as Project;

type HarnessProps = {
  showSplitToggle?: boolean;
  isSplitActive?: boolean;
  onToggleSplit?: () => void;
};

function Harness({ showSplitToggle = false, isSplitActive = false, onToggleSplit = () => {} }: HarnessProps) {
  const [activeTab, setActiveTab] = useState<AppTab>('chat');
  return (
    <>
      <WorkspaceHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedProject={PROJECT}
        selectedSession={null}
        shouldShowTasksTab
        shouldShowBrowserTab
        isMobile={false}
        onMenuClick={() => {}}
        showSplitToggle={showSplitToggle}
        isSplitActive={isSplitActive}
        onToggleSplit={onToggleSplit}
      />
      <output data-testid="active-tab">{activeTab}</output>
    </>
  );
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Workspace views' }));

test('the header has no visible tab strip', () => {
  render(<Harness />);

  assert.equal(screen.queryByRole('tablist'), null);
  assert.equal(screen.queryAllByRole('tab').length, 0);
  assert.equal(screen.queryByRole('menu'), null, 'the menu starts closed');
});

test('the views menu lists every destination, plugins included', () => {
  render(<Harness />);
  openMenu();

  const labels = screen.getAllByRole('menuitemradio').map((item) => item.textContent);
  assert.deepEqual(labels, [
    'tabs.chat',
    'tabs.shell',
    'tabs.files',
    'tabs.git',
    'tabs.browser',
    'tabs.tasks',
    'Notes',
  ]);
});

test('chat is the default and is marked as the current view', () => {
  render(<Harness />);
  openMenu();

  const checked = screen.getAllByRole('menuitemradio').filter((item) => item.getAttribute('aria-checked') === 'true');
  assert.deepEqual(checked.map((item) => item.textContent), ['tabs.chat']);
});

test('picking a destination switches to it and closes the menu', () => {
  render(<Harness />);
  openMenu();

  fireEvent.click(screen.getByRole('menuitemradio', { name: 'tabs.git' }));

  assert.equal(screen.getByTestId('active-tab').textContent, 'git');
  assert.equal(screen.queryByRole('menu'), null);

  openMenu();
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Notes' }));
  assert.equal(screen.getByTestId('active-tab').textContent, 'plugin:notes');
});

test('Escape closes the menu without reaching the chat\'s stop shortcut', () => {
  render(<Harness />);
  openMenu();

  let reachedChat = false;
  const chatEscape = (event: KeyboardEvent) => {
    if (!event.defaultPrevented) reachedChat = true;
  };
  document.addEventListener('keydown', chatEscape, { capture: true });
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  document.removeEventListener('keydown', chatEscape, { capture: true });

  assert.equal(screen.queryByRole('menu'), null);
  assert.equal(reachedChat, false);
});

test('the split toggle shows only when split view is available', () => {
  const { rerender } = render(<Harness />);
  assert.equal(screen.queryByRole('button', { name: 'Split view' }), null);

  const onToggleSplit = vi.fn();
  rerender(<Harness showSplitToggle onToggleSplit={onToggleSplit} />);
  fireEvent.click(screen.getByRole('button', { name: 'Split view' }));
  assert.equal(onToggleSplit.mock.calls.length, 1);

  rerender(<Harness showSplitToggle isSplitActive onToggleSplit={onToggleSplit} />);
  assert.ok(screen.getByRole('button', { name: 'Close split view' }));
});
