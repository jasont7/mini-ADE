import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

import { createVoiceRouter } from '../voice.routes.js';

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/voice', createVoiceRouter({
    voiceService: {} as never,
    parseAudioUpload: (_req, _res, next) => next(),
    geminiLiveService: {
      getStatus: () => ({
        configured: false, reason: 'no key', model: 'm', nonBlockingTools: false, voices: [], defaultVoice: 'Zephyr',
      }),
      mintToken: async () => ({ ok: false, status: 503, error: 'Gemini Live is not configured on the server.' }),
    },
    voiceTranscriptService: {} as never,
    sessionVoiceSettingsService: {
      get: () => ({ mode: 'off', geminiVoice: null }),
      set: (_id, input) => (input.mode === 'private'
        ? { ok: true, value: { mode: 'private', geminiVoice: null } }
        : { ok: false, status: 400, error: 'bad mode' }),
    },
  }));
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    await run(`http://127.0.0.1:${port}/api/voice`);
  } finally {
    server.close();
  }
}

test('gemini status and token routes surface the service result', async () => {
  await withServer(async (base) => {
    const status = await (await fetch(`${base}/gemini/status`)).json() as { configured: boolean };
    assert.equal(status.configured, false);
    const token = await fetch(`${base}/gemini/token`, { method: 'POST' });
    assert.equal(token.status, 503);
  });
});

test('session mode route validates through the service', async () => {
  await withServer(async (base) => {
    const put = (mode: string) => fetch(`${base}/sessions/s1/mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    assert.equal((await put('private')).status, 200);
    assert.equal((await put('x')).status, 400);
    assert.deepEqual(await (await fetch(`${base}/sessions/s1/mode`)).json(), { mode: 'off', geminiVoice: null });
  });
});

test('voice session routes pass through to the transcript service', async () => {
  const app = express();
  app.use(express.json());
  const calls: string[] = [];
  app.use('/api/voice', createVoiceRouter({
    voiceService: {} as never,
    geminiLiveService: {} as never,
    sessionVoiceSettingsService: {} as never,
    parseAudioUpload: (_req, _res, next) => next(),
    voiceTranscriptService: {
      registerSession: async (id, input) => { calls.push(`register ${id} ${String(input.name)}`); return { ok: true, value: { sessionId: id } }; },
      listSessionIds: () => ['s1'],
      list: () => ({ ok: true, value: [{ id: 'a', role: 'user', text: 'Hi', at: 1 }] }),
      append: async (id, entries) => (Array.isArray(entries)
        ? { ok: true, value: { added: entries.length } }
        : { ok: false, status: 400, error: 'bad' }),
    },
  }));
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const base = `http://127.0.0.1:${port}/api/voice`;
    const json = { 'Content-Type': 'application/json' };
    assert.deepEqual(await (await fetch(`${base}/sessions`)).json(), { sessionIds: ['s1'] });
    await fetch(`${base}/sessions/s1`, { method: 'PUT', headers: json, body: JSON.stringify({ name: 'Voice' }) });
    assert.deepEqual(calls, ['register s1 Voice']);
    assert.equal(((await (await fetch(`${base}/sessions/s1/transcript`)).json()) as { entries: unknown[] }).entries.length, 1);
    const post = (body: unknown) => fetch(`${base}/sessions/s1/transcript`, { method: 'POST', headers: json, body: JSON.stringify(body) });
    assert.deepEqual(await (await post({ entries: [{}] })).json(), { added: 1 });
    assert.equal((await post({})).status, 400);
  } finally {
    server.close();
  }
});
