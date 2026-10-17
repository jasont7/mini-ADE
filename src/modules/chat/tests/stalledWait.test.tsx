import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useStalledWait } from '@/modules/chat/hooks/useStalledWait';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const render = (initial: { waiting: boolean; key: string }) => renderHook(
  ({ waiting, key }) => useStalledWait(waiting, key, 30_000),
  { initialProps: initial },
);

test('a wait counts as stalled only once the delay has passed', () => {
  const { result } = render({ waiting: true, key: 'session-a' });

  act(() => { vi.advanceTimersByTime(29_999); });
  assert.equal(result.current.isStalled, false);

  act(() => { vi.advanceTimersByTime(1); });
  assert.equal(result.current.isStalled, true);
});

test('a finished wait is never stalled, however long it took', () => {
  const { result, rerender } = render({ waiting: true, key: 'session-a' });
  act(() => { vi.advanceTimersByTime(30_000); });

  rerender({ waiting: false, key: 'session-a' });
  assert.equal(result.current.isStalled, false);
});

test('opening another session starts the clock again', () => {
  const { result, rerender } = render({ waiting: true, key: 'session-a' });
  act(() => { vi.advanceTimersByTime(30_000); });

  rerender({ waiting: true, key: 'session-b' });
  assert.equal(result.current.isStalled, false, 'the stall belonged to session A');

  act(() => { vi.advanceTimersByTime(30_000); });
  assert.equal(result.current.isStalled, true);
});

test('a retry gets its own full delay before Retry shows again', () => {
  const { result } = render({ waiting: true, key: 'session-a' });
  act(() => { vi.advanceTimersByTime(30_000); });
  assert.equal(result.current.isStalled, true);

  act(() => { result.current.restart(); });
  assert.equal(result.current.isStalled, false);

  act(() => { vi.advanceTimersByTime(30_000); });
  assert.equal(result.current.isStalled, true);
});
