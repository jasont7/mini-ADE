import assert from 'node:assert/strict';
import test from 'node:test';

import { createSessionVoiceSettingsService } from '../session-voice-settings.service.js';

function build() {
  const rows = new Map<string, { mode: string; geminiVoice: string | null }>();
  const service = createSessionVoiceSettingsService({
    voices: ['Kore', 'Puck'],
    store: {
      get: (id) => rows.get(id) ?? null,
      upsert: (record) => {
        rows.set(record.sessionId, { mode: record.mode, geminiVoice: record.geminiVoice });
      },
    },
  });
  return { service, rows };
}

test('defaults to off for an unknown session', () => {
  assert.deepEqual(build().service.get('s1'), { mode: 'off', geminiVoice: null });
});

test('stores and returns the mode with its voice preset', () => {
  const { service } = build();
  const result = service.set('s1', { mode: 'gemini', geminiVoice: 'Kore' });
  assert.deepEqual(result, { ok: true, value: { mode: 'gemini', geminiVoice: 'Kore' } });
  assert.deepEqual(service.get('s1'), { mode: 'gemini', geminiVoice: 'Kore' });
});

test('rejects unknown modes and voices without storing', () => {
  const { service, rows } = build();
  assert.equal(service.set('s1', { mode: 'loud' }).ok, false);
  assert.equal(service.set('s1', { mode: 'gemini', geminiVoice: 'Nope' }).ok, false);
  assert.equal(service.set('s1', { mode: 'private', geminiVoice: 42 }).ok, false);
  assert.equal(rows.size, 0);
});

test('treats a corrupt stored mode as off', () => {
  const { service, rows } = build();
  rows.set('s1', { mode: 'weird', geminiVoice: null });
  assert.equal(service.get('s1').mode, 'off');
});
