import assert from 'node:assert/strict';
import test from 'node:test';

import { trackBackgroundTasks } from '@/modules/providers/list/claude/claude-runtime.provider.js';

// The runtime holds a CLI process open while this map is non-empty, and tells
// clients whenever it changes. A follow-up turn that starts nothing must still
// see a shell from an earlier turn, or releasing stdin kills it.

const started = (taskId: string, description = 'sleep 25') => ({
  type: 'system',
  subtype: 'task_started',
  task_id: taskId,
  task_type: 'local_bash',
  description,
});

test('a started task stays running across turns until it reports an end', () => {
  const running = new Map<string, string>();
  assert.equal(trackBackgroundTasks(started('bzhkf5nl6', 'sleep 25 && echo finished'), running), true);
  // An unrelated follow-up turn: model output and its result change nothing.
  assert.equal(trackBackgroundTasks({ type: 'assistant', message: { content: [{ type: 'text', text: 'second' }] } }, running), false);
  assert.equal(trackBackgroundTasks({ type: 'result', subtype: 'success' }, running), false);
  assert.deepEqual([...running], [['bzhkf5nl6', 'sleep 25 && echo finished']]);

  assert.equal(
    trackBackgroundTasks({ type: 'system', subtype: 'task_notification', task_id: 'bzhkf5nl6', status: 'completed' }, running),
    true,
  );
  assert.equal(running.size, 0);
});

test('a terminal task_updated ends the task, a progress update does not', () => {
  const running = new Map<string, string>();
  trackBackgroundTasks(started('a1'), running);
  assert.equal(
    trackBackgroundTasks({ type: 'system', subtype: 'task_updated', task_id: 'a1', patch: { status: 'running' } }, running),
    false,
  );
  assert.equal(running.size, 1);

  for (const status of ['completed', 'failed', 'killed']) {
    trackBackgroundTasks(started('a1'), running);
    trackBackgroundTasks({ type: 'system', subtype: 'task_updated', task_id: 'a1', patch: { status } }, running);
    assert.equal(running.size, 0, status);
  }
});

test('an end reported twice only counts as a change once', () => {
  const running = new Map<string, string>();
  trackBackgroundTasks(started('a1'), running);
  assert.equal(trackBackgroundTasks({ type: 'system', subtype: 'task_updated', task_id: 'a1', patch: { status: 'completed' } }, running), true);
  assert.equal(trackBackgroundTasks({ type: 'system', subtype: 'task_notification', task_id: 'a1', status: 'completed' }, running), false);
});

test('tasks are tracked independently', () => {
  const running = new Map<string, string>();
  trackBackgroundTasks(started('shell'), running);
  trackBackgroundTasks(started('monitor', 'Narval Makefile'), running);
  trackBackgroundTasks({ type: 'system', subtype: 'task_notification', task_id: 'shell', status: 'completed' }, running);
  assert.deepEqual([...running.keys()], ['monitor']);
});
