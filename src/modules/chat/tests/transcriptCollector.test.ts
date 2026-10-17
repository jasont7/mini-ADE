import assert from 'node:assert/strict';

import { test } from 'vitest';

import { createTranscriptCollector } from '@/modules/chat/utils/transcriptCollector';

function setup() {
  const saved: Array<[string, string, number]> = [];
  const clock = { now: 100 };
  const collector = createTranscriptCollector((role, text, at) => saved.push([role, text, at]), () => clock.now);
  return { collector, saved, clock };
}

test('pieces are joined into one turn, stamped with when the turn started', () => {
  const { collector, saved, clock } = setup();
  collector.heard('What is');
  clock.now = 150;
  collector.heard(' the plan?');
  assert.deepEqual(saved, []);
  collector.flush();
  assert.deepEqual(saved, [['user', 'What is the plan?', 100]]);
});

test('the other side starting closes the turn before it, so the order reads as it happened', () => {
  const { collector, saved, clock } = setup();
  collector.heard('Open the plan.');
  clock.now = 200;
  collector.said('On it.');
  clock.now = 300;
  collector.heard('Thanks.');
  collector.flush();
  assert.deepEqual(saved, [['user', 'Open the plan.', 100], ['gemini', 'On it.', 200], ['user', 'Thanks.', 300]]);
});

test('a note closes what is half said, then is saved on its own line', () => {
  const { collector, saved, clock } = setup();
  collector.said('Let me check.');
  clock.now = 400;
  collector.note('Asked Claude: list files');
  assert.deepEqual(saved, [['gemini', 'Let me check.', 100], ['tool', 'Asked Claude: list files', 400]]);
});

test('empty and whitespace-only turns are never saved, and flushing twice saves nothing twice', () => {
  const { collector, saved } = setup();
  collector.heard('   ');
  collector.flush();
  collector.said('Hi');
  collector.flush();
  collector.flush();
  assert.deepEqual(saved.map((item) => item[1]), ['Hi']);
});
