import assert from 'node:assert/strict';

import { test } from 'vitest';

import { createLiveVoiceState, reduceLiveVoice } from '@/modules/chat/utils/liveVoiceMachine';
import type { LiveVoiceEvent } from '@/modules/chat/utils/liveVoiceMachine';

function run(events: LiveVoiceEvent[]) {
  let state = createLiveVoiceState();
  const effects: string[] = [];
  for (const event of events) {
    const next = reduceLiveVoice(state, event);
    state = next.state;
    effects.push(...next.effects);
  }
  return { state, effects };
}

test('walks connecting, listening, thinking, speaking, listening', () => {
  assert.equal(run([{ type: 'connect' }, { type: 'ready' }]).state.phase, 'listening');
  assert.equal(run([{ type: 'ready' }, { type: 'speechStart' }, { type: 'speechEnd' }]).state.phase, 'thinking');
  assert.equal(
    run([{ type: 'ready' }, { type: 'speechEnd' }, { type: 'replyStart' }]).state.phase,
    'speaking',
  );
  assert.equal(
    run([{ type: 'ready' }, { type: 'speechEnd' }, { type: 'replyStart' }, { type: 'replyEnd' }]).state.phase,
    'listening',
  );
});

test('barge-in: speech while speaking returns to listening and stops playback', () => {
  const { state, effects } = run([
    { type: 'ready' }, { type: 'speechEnd' }, { type: 'replyStart' }, { type: 'speechStart' },
  ]);
  assert.equal(state.phase, 'listening');
  assert.deepEqual(effects, ['stopPlayback']);
});

test('speech while Claude is thinking does not change the phase or stop anything', () => {
  const { state, effects } = run([{ type: 'ready' }, { type: 'speechEnd' }, { type: 'speechStart' }]);
  assert.equal(state.phase, 'thinking');
  assert.deepEqual(effects, []);
});

test('mute ignores speech but lets a reply keep playing', () => {
  const muted = run([{ type: 'ready' }, { type: 'mute' }, { type: 'speechEnd' }]);
  assert.equal(muted.state.phase, 'listening');
  const speaking = run([{ type: 'ready' }, { type: 'speechEnd' }, { type: 'replyStart' }, { type: 'mute' }, { type: 'speechStart' }]);
  assert.equal(speaking.state.phase, 'speaking');
  assert.deepEqual(speaking.effects, []);
  assert.equal(run([{ type: 'mute' }, { type: 'unmute' }]).state.muted, false);
});

test('failure sticks until reconnect and stops playback', () => {
  const failed = run([{ type: 'ready' }, { type: 'fail', error: 'mic denied' }, { type: 'ready' }, { type: 'speechEnd' }]);
  assert.equal(failed.state.phase, 'error');
  assert.equal(failed.state.error, 'mic denied');
  assert.deepEqual(failed.effects, ['stopPlayback']);
  assert.equal(run([{ type: 'fail', error: 'x' }, { type: 'connect' }]).state.phase, 'connecting');
});

test('events before the session is ready are ignored', () => {
  assert.equal(run([{ type: 'speechEnd' }, { type: 'replyStart' }]).state.phase, 'connecting');
});
