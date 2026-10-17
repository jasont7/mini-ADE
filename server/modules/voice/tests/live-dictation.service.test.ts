import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { WebSocket, WebSocketServer } from 'ws';

import { createLiveDictationService } from '@/modules/voice/live-dictation.service.js';

type Harness = {
  upstreamHeaders: Array<Record<string, string | string[] | undefined>>;
  upstreamPaths: string[];
  upstreamFrames: Array<{ binary: boolean; size: number; text: string }>;
  upstreamClosed: Promise<void>;
  proxyUrl: string;
  close: () => Promise<void>;
};

async function startHarness(options: { apiKey?: string; baseUrl?: (port: number) => string } = {}): Promise<Harness> {
  const upstreamHeaders: Harness['upstreamHeaders'] = [];
  const upstreamPaths: string[] = [];
  const upstreamFrames: Harness['upstreamFrames'] = [];

  let markUpstreamClosed: () => void = () => undefined;
  const upstreamClosed = new Promise<void>((resolve) => { markUpstreamClosed = resolve; });
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => upstream.once('listening', resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  upstream.on('connection', (socket, request) => {
    upstreamHeaders.push(request.headers);
    upstreamPaths.push(request.url ?? '');
    socket.once('close', () => markUpstreamClosed());
    socket.send(JSON.stringify({ type: 'ready', tag: '[voice] ' }));
    socket.on('message', (data, isBinary) => {
      const buffer = data as Buffer;
      upstreamFrames.push({ binary: isBinary, size: buffer.length, text: isBinary ? '' : buffer.toString() });
      if (!isBinary) {
        socket.send(JSON.stringify({ type: 'final', text: 'hello world' }));
        socket.close();
      } else {
        socket.send(JSON.stringify({ type: 'delta', text: ' word' }));
      }
    });
  });

  const service = createLiveDictationService({
    baseUrl: options.baseUrl ? options.baseUrl(upstreamPort) : `http://127.0.0.1:${upstreamPort}/v1`,
    apiKey: options.apiKey ?? '',
  });
  const proxy = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => proxy.once('listening', resolve));
  proxy.on('connection', (socket, request) => service.handleConnection(socket, request));

  return {
    upstreamHeaders,
    upstreamPaths,
    upstreamFrames,
    upstreamClosed,
    proxyUrl: `ws://127.0.0.1:${(proxy.address() as AddressInfo).port}/api/voice/dictate`,
    close: async () => {
      for (const client of [...upstream.clients, ...proxy.clients]) client.terminate();
      await Promise.all([
        new Promise((resolve) => upstream.close(resolve)),
        new Promise((resolve) => proxy.close(resolve)),
      ]);
    },
  };
}

function collect(socket: WebSocket) {
  const messages: Array<{ binary: boolean; text: string }> = [];
  socket.on('message', (data, binary) => messages.push({ binary, text: (data as Buffer).toString() }));
  const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
  return { messages, closed };
}

test('relays binary audio up and json events down, then closes both sides on final', async () => {
  const harness = await startHarness({ apiKey: 'default-key' });
  try {
    const client = new WebSocket(harness.proxyUrl);
    const { messages, closed } = collect(client);
    await new Promise((resolve) => client.once('open', resolve));
    // Give the upstream `ready` time to arrive before sending, as the real client does.
    await new Promise((resolve) => setTimeout(resolve, 100));
    client.send(Buffer.alloc(4800), { binary: true });
    client.send(JSON.stringify({ type: 'end' }));
    await closed;

    assert.deepEqual(messages.map((m) => JSON.parse(m.text).type), ['ready', 'delta', 'final']);
    assert.equal(harness.upstreamFrames[0].binary, true);
    assert.equal(harness.upstreamFrames[0].size, 4800);
    assert.equal(harness.upstreamFrames[1].text, '{"type":"end"}');
    assert.equal(harness.upstreamPaths[0], '/v1/audio/transcriptions/stream');
    assert.equal(harness.upstreamHeaders[0].authorization, 'Bearer default-key');
  } finally {
    await harness.close();
  }
});

test('a per-user voice_key overrides the default bearer token', async () => {
  const harness = await startHarness({ apiKey: 'default-key' });
  try {
    const client = new WebSocket(`${harness.proxyUrl}?voice_key=user-key`);
    const { closed } = collect(client);
    await new Promise((resolve) => client.once('open', resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));
    client.send(JSON.stringify({ type: 'end' }));
    await closed;
    assert.equal(harness.upstreamHeaders[0].authorization, 'Bearer user-key');
  } finally {
    await harness.close();
  }
});

test('closing the client closes the upstream', async () => {
  const harness = await startHarness();
  try {
    const client = new WebSocket(harness.proxyUrl);
    const { messages } = collect(client);
    await new Promise((resolve) => client.once('open', resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(messages.length, 1);
    client.close();
    await harness.upstreamClosed;
  } finally {
    await harness.close();
  }
});

test('closes the client with 4503 when no speech backend is configured', async () => {
  const harness = await startHarness({ baseUrl: () => '' });
  try {
    const client = new WebSocket(harness.proxyUrl);
    const { closed } = collect(client);
    assert.equal(await closed, 4503);
  } finally {
    await harness.close();
  }
});

test('closes the client with 4502 when the upstream cannot be reached', async () => {
  const harness = await startHarness({ baseUrl: () => 'http://127.0.0.1:1/v1' });
  try {
    const client = new WebSocket(harness.proxyUrl);
    const { closed } = collect(client);
    assert.equal(await closed, 4502);
  } finally {
    await harness.close();
  }
});
