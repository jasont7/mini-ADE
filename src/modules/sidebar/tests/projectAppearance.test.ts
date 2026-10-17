import assert from 'node:assert/strict';

import { test } from 'vitest';

import { parseProjectColors, parseProjectIcons } from '@/modules/sidebar/hooks/useProjectAppearance';

test('reads emoji and icon choices keyed by project id', () => {
  const icons = parseProjectIcons({
    'p-1': { kind: 'emoji', emoji: '🚀' },
    'p-2': { kind: 'glyph', name: 'flask' },
  });

  assert.deepEqual(icons.get('p-1'), { kind: 'emoji', emoji: '🚀' });
  assert.deepEqual(icons.get('p-2'), { kind: 'glyph', name: 'flask' });
});

test('drops entries this build cannot draw, so those projects keep their initials', () => {
  const icons = parseProjectIcons({
    unknownGlyph: { kind: 'glyph', name: 'not-an-icon' },
    blankEmoji: { kind: 'emoji', emoji: '   ' },
    wrongShape: '🚀',
    futureKind: { kind: 'image', url: 'x' },
  });

  assert.equal(icons.size, 0);
});

test('treats a missing or malformed preference as no icons at all', () => {
  for (const stored of [null, undefined, 'x', 42, ['🚀']]) {
    assert.equal(parseProjectIcons(stored).size, 0);
  }
});

test('reads colour choices and ignores colours this build does not have', () => {
  const colors = parseProjectColors({ 'p-1': 'teal', 'p-2': 'chartreuse', 'p-3': 42 });
  assert.deepEqual([...colors], [['p-1', 'teal']]);
  assert.equal(parseProjectColors(null).size, 0);
});
