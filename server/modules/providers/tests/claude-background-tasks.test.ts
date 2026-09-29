import assert from 'node:assert/strict';
import test from 'node:test';

import { trackBackgroundTasks } from '@/modules/providers/list/claude/claude-runtime.provider.js';

// The runtime holds a CLI process open while this set is non-empty. A follow-up
// turn that starts nothing must still see a shell from an earlier turn, or
// releasing stdin kills it.

const started = (taskId: string) => ({ type: 'system', subtype: 'task_started', task_id: taskId, task_type: 'local_bash' });

test('a started task stays running across turns until it reports an end', () => {
  const running = new Set<string>();
  trackBackgroundTasks(started('bzhkf5nl6'), running);
  // An unrelated follow-up turn: model output and its result change nothing.
  trackBackgroundTasks({ type: 'assistant', message: { content: [{ type: 'text', text: 'second' }] } }, running);
  trackBackgroundTasks({ type: 'result', subtype: 'success' }, running);
  assert.deepEqual([...running], ['bzhkf5nl6']);

  trackBackgroundTasks({ type: 'system', subtype: 'task_notification', task_id: 'bzhkf5nl6', status: 'completed' }, running);
  assert.equal(running.size, 0);
});

test('a terminal task_updated ends the task, a progress update does not', () => {
  const running = new Set<string>();
  trackBackgroundTasks(started('a1'), running);
  trackBackgroundTasks({ type: 'system', subtype: 'task_updated', task_id: 'a1', patch: { status: 'running' } }, running);
  assert.equal(running.size, 1);

  for (const status of ['completed', 'failed', 'killed']) {
    trackBackgroundTasks(started('a1'), running);
    trackBackgroundTasks({ type: 'system', subtype: 'task_updated', task_id: 'a1', patch: { status } }, running);
    assert.equal(running.size, 0, status);
  }
});

test('tasks are tracked independently', () => {
  const running = new Set<string>();
  trackBackgroundTasks(started('shell'), running);
  trackBackgroundTasks(started('monitor'), running);
  trackBackgroundTasks({ type: 'system', subtype: 'task_notification', task_id: 'shell', status: 'completed' }, running);
  assert.deepEqual([...running], ['monitor']);
});
