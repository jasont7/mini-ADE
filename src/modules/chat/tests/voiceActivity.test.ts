import assert from 'node:assert/strict';

import { test } from 'vitest';

import { createVoiceActivityDetector } from '@/modules/chat/utils/voiceActivity';
import type { VoiceActivityEvent } from '@/modules/chat/utils/voiceActivity';

const FRAME_MS = 20;

function feed(detector: ReturnType<typeof createVoiceActivityDetector>, rms: number, ms: number) {
  const events: Array<VoiceActivityEvent & { atMs: number }> = [];
  for (let elapsed = FRAME_MS; elapsed <= ms; elapsed += FRAME_MS) {
    const event = detector.push(rms, FRAME_MS);
    if (event) events.push({ ...event, atMs: elapsed });
  }
  return events;
}

test('reports speech start within the barge-in budget of 300 ms', () => {
  const detector = createVoiceActivityDetector();
  feed(detector, 0.002, 500);
  const [start] = feed(detector, 0.2, 400);
  assert.equal(start.type, 'start');
  assert.ok(start.atMs <= 100, `start took ${start.atMs} ms`);
});

test('ends an utterance after the silence hangover and reports speech length', () => {
  const detector = createVoiceActivityDetector();
  feed(detector, 0.002, 500);
  feed(detector, 0.2, 1000);
  const events = feed(detector, 0.002, 1200);
  const end = events.find((event) => event.type === 'end');
  assert.ok(end && end.type === 'end');
  assert.ok(end.speechMs >= 900 && end.speechMs <= 1100, `speechMs ${end.speechMs}`);
});

test('a short pause inside a sentence does not end the utterance', () => {
  const detector = createVoiceActivityDetector();
  feed(detector, 0.002, 500);
  feed(detector, 0.2, 400);
  assert.deepEqual(feed(detector, 0.002, 500), []);
  assert.deepEqual(feed(detector, 0.2, 400), []);
});

test('speech in the first moments is not taken as the noise floor', () => {
  const detector = createVoiceActivityDetector();
  feed(detector, 0.002, 100);
  const events = [...feed(detector, 0.3, 400), ...feed(detector, 0.002, 1200), ...feed(detector, 0.3, 200)];
  assert.ok(events.some((event) => event.type === 'start'));
});

test('a single click shorter than the start window is ignored', () => {
  const detector = createVoiceActivityDetector();
  feed(detector, 0.002, 500);
  assert.deepEqual(feed(detector, 0.3, 20), []);
  assert.deepEqual(feed(detector, 0.002, 400), []);
});

test('steady room noise raises the floor and never reads as speech', () => {
  const detector = createVoiceActivityDetector();
  assert.deepEqual(feed(detector, 0.02, 2000).filter((event) => event.type === 'start'), []);
});
