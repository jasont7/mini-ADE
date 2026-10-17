import assert from 'node:assert/strict';

import { test } from 'vitest';

import { createIdleWatchdog, GEMINI_IDLE_TIMEOUT_MS } from '@/modules/chat/utils/idleWatchdog';

test('expires after two minutes of silence and not before', () => {
  const watchdog = createIdleWatchdog(GEMINI_IDLE_TIMEOUT_MS, 0);
  assert.equal(GEMINI_IDLE_TIMEOUT_MS, 120_000);
  assert.equal(watchdog.isExpired(119_999), false);
  assert.equal(watchdog.isExpired(120_000), true);
});

test('activity restarts the clock', () => {
  const watchdog = createIdleWatchdog(120_000, 0);
  watchdog.touch(100_000);
  assert.equal(watchdog.isExpired(200_000), false);
  assert.equal(watchdog.isExpired(220_000), true);
});

test('never expires while Claude is working, then restarts the full timeout', () => {
  const watchdog = createIdleWatchdog(120_000, 0);
  watchdog.setBusy(true, 10_000);
  assert.equal(watchdog.isExpired(900_000), false);
  watchdog.setBusy(false, 900_000);
  assert.equal(watchdog.isExpired(1_000_000), false);
  assert.equal(watchdog.isExpired(1_020_000), true);
});
