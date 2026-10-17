import assert from 'node:assert/strict';
import test from 'node:test';

import { createGeminiLiveService } from '../gemini-live.service.js';

const SECRET = 'fake-test-key-not-real';

function build(options: { apiKey?: string; model?: string; respond?: () => Promise<Response> } = {}) {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const service = createGeminiLiveService({
    apiKey: options.apiKey ?? SECRET,
    model: options.model ?? 'gemini-3.8-live',
    now: () => Date.UTC(2026, 9, 8, 12, 0, 0),
    fetchGoogle: async (url, init) => {
      calls.push({ url, options: init });
      return options.respond
        ? options.respond()
        : new Response(JSON.stringify({ name: 'auth_tokens/abc123' }), { status: 200 });
    },
  });
  return { service, calls };
}

test('status is disabled with a reason and never exposes the key', () => {
  const { service } = build({ apiKey: '' });
  const status = service.getStatus();
  assert.equal(status.configured, false);
  assert.match(status.reason ?? '', /GEMINI_API_KEY/);
  assert.ok(status.voices.includes('Kore'));
  assert.equal(JSON.stringify(status).includes(SECRET), false);
});

test('status reports non-blocking tools only for 2.5 Live models', () => {
  assert.equal(build().service.getStatus().nonBlockingTools, false);
  assert.equal(
    build({ model: 'gemini-2.5-flash-native-audio-preview-12-2025' }).service.getStatus().nonBlockingTools,
    true,
  );
});

test('mints a one-use token constrained to the model, with the key only in the Google header', async () => {
  const { service, calls } = build();
  const result = await service.mintToken();

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.token, 'auth_tokens/abc123');
  assert.equal(JSON.stringify(result.value).includes(SECRET), false);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/auth_tokens');
  assert.equal((calls[0].options.headers as Record<string, string>)['x-goog-api-key'], SECRET);
  const body = JSON.parse(String(calls[0].options.body));
  assert.equal(body.uses, 1);
  assert.equal('liveConnectConstraints' in body, false);
  assert.equal(body.expireTime, '2026-10-08T12:30:00.000Z');
  assert.equal(body.newSessionExpireTime, '2026-10-08T12:01:00.000Z');
  assert.equal(String(calls[0].options.body).includes(SECRET), false);
});

test('refuses to mint without a key and does not call Google', async () => {
  const { service, calls } = build({ apiKey: '' });
  const result = await service.mintToken();
  assert.deepEqual(result.ok, false);
  assert.equal(calls.length, 0);
});

test('failures never leak the key or Google response body', async () => {
  const { service } = build({
    respond: async () => new Response(`bad key ${SECRET}`, { status: 403 }),
  });
  const result = await service.mintToken();
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(SECRET), false);

  const unreachable = build({ respond: async () => { throw new Error(`boom ${SECRET}`); } });
  const failed = await unreachable.service.mintToken();
  assert.equal(failed.ok, false);
  assert.equal(JSON.stringify(failed).includes(SECRET), false);
});

test('rejects a response without a token name', async () => {
  const { service } = build({ respond: async () => new Response('{}', { status: 200 }) });
  assert.equal((await service.mintToken()).ok, false);
});
