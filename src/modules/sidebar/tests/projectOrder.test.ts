import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Project } from '@/shared/types';
import { arrangeRailSections, reorderRailSections } from '@/modules/sidebar/utils/projectOrder';

const project = (projectId: string, isStarred = false): Project => ({
  projectId,
  displayName: projectId,
  fullPath: `/work/${projectId}`,
  isStarred,
});

// As the controller hands them over: starred first, then by the sort setting.
const sorted = [
  project('alpha', true),
  project('bravo', true),
  project('charlie'),
  project('delta'),
  project('echo'),
];

const ids = (projects: Project[]) => projects.map((entry) => entry.projectId);

test('with nothing dragged yet, each section keeps the sort setting order', () => {
  const sections = arrangeRailSections(sorted, []);
  assert.deepEqual(ids(sections.starred), ['alpha', 'bravo']);
  assert.deepEqual(ids(sections.regular), ['charlie', 'delta', 'echo']);
});

test('a saved order is applied within each section', () => {
  const sections = arrangeRailSections(sorted, ['bravo', 'alpha', 'echo', 'charlie', 'delta']);
  assert.deepEqual(ids(sections.starred), ['bravo', 'alpha']);
  assert.deepEqual(ids(sections.regular), ['echo', 'charlie', 'delta']);
});

test('a project created after the last drag goes to the end of its section', () => {
  const sections = arrangeRailSections([...sorted, project('aaa-new')], ['echo', 'delta', 'charlie']);
  assert.deepEqual(ids(sections.regular), ['echo', 'delta', 'charlie', 'aaa-new']);
});

test('dragging a tile onto another moves it there and saves both sections', () => {
  const sections = arrangeRailSections(sorted, []);
  assert.deepEqual(
    reorderRailSections(sections, 'echo', 'charlie'),
    ['alpha', 'bravo', 'echo', 'charlie', 'delta'],
  );
  assert.deepEqual(
    reorderRailSections(sections, 'alpha', 'bravo'),
    ['bravo', 'alpha', 'charlie', 'delta', 'echo'],
  );
});

test('a drop into the other section, or onto itself, changes nothing', () => {
  const sections = arrangeRailSections(sorted, []);
  assert.equal(reorderRailSections(sections, 'alpha', 'delta'), null);
  assert.equal(reorderRailSections(sections, 'delta', 'delta'), null);
});

test('starring a project keeps its arranged place relative to the favourites', () => {
  const saved = ['alpha', 'charlie', 'bravo', 'delta', 'echo'];
  const afterStarring = sorted.map((entry) => (entry.projectId === 'charlie' ? { ...entry, isStarred: true } : entry));
  const sections = arrangeRailSections(afterStarring, saved);
  assert.deepEqual(ids(sections.starred), ['alpha', 'charlie', 'bravo']);
});
