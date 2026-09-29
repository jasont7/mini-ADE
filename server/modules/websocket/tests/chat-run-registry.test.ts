import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

/**
 * Minimal stand-in for a websocket connection: collects every JSON frame the
 * gateway writer forwards so assertions can inspect the outbound protocol.
 */
class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-run-registry-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('live events are remapped to the app session id and sequenced', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-1', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-1',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: 'user-1',
    });
    assert.ok(run);

    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'provider-id-9', content: 'hello' });
    run.writer.send({ kind: 'text', provider: 'claude', sessionId: 'provider-id-9', content: 'hello world' });

    assert.equal(connection.frames.length, 2);
    assert.equal(connection.frames[0]?.sessionId, 'app-run-1');
    assert.equal(connection.frames[0]?.seq, 1);
    assert.equal(connection.frames[1]?.sessionId, 'app-run-1');
    assert.equal(connection.frames[1]?.seq, 2);
  });
});

test('session_created is swallowed and persisted as the provider-id mapping', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-run-2', 'cursor', '/workspace/demo');
    const connection = new FakeConnection();
    connectedClients.add(connection as never);
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-2',
      provider: 'cursor',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({
      kind: 'session_created',
      provider: 'cursor',
      sessionId: 'cursor-native-7',
      newSessionId: 'cursor-native-7',
    });

    // The upsert is broadcast without blocking the run: resolving the owning
    // project's display name is async, so let that settle before asserting.
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    // The provider-native event itself is never forwarded...
    const sessionUpserts = connection.frames.filter((frame) => frame.kind === 'session_upserted');
    assert.equal(sessionUpserts.length, 1);
    assert.equal(sessionUpserts[0]?.sessionId, 'app-run-2');
    assert.equal(sessionUpserts[0]?.providerSessionId, 'cursor-native-7');
    // ...but the canonical mapping is recorded and persisted in the database.
    assert.equal(run.providerSessionId, 'cursor-native-7');
    assert.equal(sessionsDb.getSessionById('app-run-2')?.provider_session_id, 'cursor-native-7');
  });
});

test('complete marks the run finished and duplicate completes are dropped', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-3', 'codex', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-3',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({ kind: 'complete', provider: 'codex', sessionId: 'native-3', exitCode: 0 });
    // Late duplicate from a killed runtime's exit handler.
    run.writer.send({ kind: 'complete', provider: 'codex', sessionId: 'native-3', exitCode: 1 });

    const completes = connection.frames.filter((frame) => frame.kind === 'complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0]?.actualSessionId, 'app-run-3');
    assert.equal(chatRunRegistry.isProcessing('app-run-3'), false);

    // completeRun is also a no-op once the run already completed.
    chatRunRegistry.completeRun('app-run-3', { exitCode: 1 });
    assert.equal(connection.frames.filter((frame) => frame.kind === 'complete').length, 1);
  });
});

test('a finished run\'s safety net cannot complete the session\'s next run', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-9', 'codex', '/workspace/demo');
    const connection = new FakeConnection();

    const firstRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-9',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(firstRun);
    firstRun.writer.send({ kind: 'complete', provider: 'codex', sessionId: 'native-9', exitCode: 0 });

    // A queued message starts the next run before the first run's runtime
    // promise settles (the chat handler's `finally` hasn't executed yet).
    const secondRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-9',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(secondRun);

    // First run's safety net fires late: it must not touch the new run.
    chatRunRegistry.completeRunIfCurrent(firstRun, { exitCode: 1 });
    assert.equal(chatRunRegistry.isProcessing('app-run-9'), true);
    assert.equal(connection.frames.filter((frame) => frame.kind === 'complete').length, 1);

    // The second run's own safety net still works while it is current.
    chatRunRegistry.completeRunIfCurrent(secondRun, { exitCode: 1 });
    assert.equal(chatRunRegistry.isProcessing('app-run-9'), false);
    assert.equal(connection.frames.filter((frame) => frame.kind === 'complete').length, 2);
  });
});

test('a completed run resumes when its process starts a turn on its own', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-10', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-10',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    // Still running: nothing to resume.
    assert.equal(run.writer.resumeRun(), false);

    run.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-10', exitCode: 0 });
    assert.equal(chatRunRegistry.isProcessing('app-run-10'), false);

    // Background work reports back and the CLI starts another turn.
    assert.equal(run.writer.resumeRun(), true);
    assert.equal(chatRunRegistry.isProcessing('app-run-10'), true);
    assert.deepEqual(
      chatRunRegistry.listRunningRuns().map((running) => running.sessionId),
      ['app-run-10'],
    );
    const resumed = connection.frames.filter((frame) => frame.kind === 'run_resumed');
    assert.equal(resumed.length, 1);
    assert.equal(resumed[0]?.sessionId, 'app-run-10');

    // A second sender is refused while that turn runs...
    assert.equal(chatRunRegistry.startRun({
      appSessionId: 'app-run-10',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    }), null);

    // ...and the turn ends with its own complete, which is not a duplicate.
    run.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-10', exitCode: 0 });
    assert.equal(connection.frames.filter((frame) => frame.kind === 'complete').length, 2);
    assert.equal(chatRunRegistry.isProcessing('app-run-10'), false);
  });
});

test('a run replaced by a newer one cannot resume', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-11', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const firstRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-11',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(firstRun);
    firstRun.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-11', exitCode: 0 });

    const secondRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-11',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(secondRun);
    secondRun.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-11', exitCode: 0 });

    assert.equal(firstRun.writer.resumeRun(), false);
    assert.equal(chatRunRegistry.isProcessing('app-run-11'), false);
    assert.equal(connection.frames.filter((frame) => frame.kind === 'run_resumed').length, 0);
  });
});

test('background tasks are remembered per session and survive the run completing', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-12', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const firstRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-12',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(firstRun);

    const tasks = [{ id: 'bzhkf5nl6', description: 'sleep 25 && echo finished' }];
    firstRun.writer.send({ kind: 'background_tasks', provider: 'claude', sessionId: 'native-12', backgroundTasks: tasks });
    firstRun.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-12', exitCode: 0 });
    // The turn is over but the shell is not.
    assert.deepEqual(chatRunRegistry.getBackgroundTasks('app-run-12'), tasks);
    assert.equal(connection.frames.find((frame) => frame.kind === 'background_tasks')?.sessionId, 'app-run-12');

    // A newer run owns the session now; the old run's wind-down cannot clear it.
    const secondRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-12',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(secondRun);
    firstRun.writer.send({ kind: 'background_tasks', provider: 'claude', sessionId: 'native-12', backgroundTasks: [] });
    assert.deepEqual(chatRunRegistry.getBackgroundTasks('app-run-12'), tasks);

    secondRun.writer.send({ kind: 'background_tasks', provider: 'claude', sessionId: 'native-12', backgroundTasks: [] });
    assert.deepEqual(chatRunRegistry.getBackgroundTasks('app-run-12'), []);
  });
});

test('a run evicted while completed still resumes when its process starts a turn', async () => {
  await withIsolatedDatabase(() => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      sessionsDb.createAppSession('app-run-13', 'claude', '/workspace/demo');
      const connection = new FakeConnection();
      const run = chatRunRegistry.startRun({
        appSessionId: 'app-run-13',
        provider: 'claude',
        providerSessionId: null,
        connection,
        userId: null,
      });
      assert.ok(run);
      const tasks = [{ id: 'bcq8te2rg', description: 'Train the model on fal' }];
      run.writer.send({ kind: 'background_tasks', provider: 'claude', sessionId: 'native-13', backgroundTasks: tasks });
      run.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-13', exitCode: 0 });

      // The training job reports back well after the retention window.
      mock.timers.tick(8 * 60 * 1000);
      assert.equal(chatRunRegistry.getRun('app-run-13'), undefined);

      assert.equal(run.writer.resumeRun(), true);
      assert.equal(chatRunRegistry.isProcessing('app-run-13'), true);
      assert.deepEqual(chatRunRegistry.listRunningRuns().map((running) => running.sessionId), ['app-run-13']);

      // The evicted run still speaks for the session's task list too.
      run.writer.send({ kind: 'background_tasks', provider: 'claude', sessionId: 'native-13', backgroundTasks: [] });
      assert.deepEqual(chatRunRegistry.getBackgroundTasks('app-run-13'), []);

      run.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-13', exitCode: 0 });
      assert.equal(chatRunRegistry.isProcessing('app-run-13'), false);
    } finally {
      mock.timers.reset();
    }
  });
});

test('an evicted run cannot resume once a newer run has started', async () => {
  await withIsolatedDatabase(() => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      sessionsDb.createAppSession('app-run-14', 'claude', '/workspace/demo');
      const connection = new FakeConnection();
      const start = () => chatRunRegistry.startRun({
        appSessionId: 'app-run-14',
        provider: 'claude',
        providerSessionId: null,
        connection,
        userId: null,
      });
      const firstRun = start();
      assert.ok(firstRun);
      firstRun.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-14', exitCode: 0 });
      mock.timers.tick(8 * 60 * 1000);

      const secondRun = start();
      assert.ok(secondRun);
      secondRun.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-14', exitCode: 0 });
      mock.timers.tick(8 * 60 * 1000);

      // Both evicted; only the newer one may come back.
      assert.equal(firstRun.writer.resumeRun(), false);
      assert.equal(chatRunRegistry.isProcessing('app-run-14'), false);
      assert.equal(secondRun.writer.resumeRun(), true);
    } finally {
      mock.timers.reset();
    }
  });
});

test('listRunningRuns returns only currently running app sessions', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-7', 'claude', '/workspace/demo');
    sessionsDb.createAppSession('app-run-8', 'codex', '/workspace/demo');
    const connection = new FakeConnection();

    const completedRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-7',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(completedRun);

    const runningRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-8',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(runningRun);

    chatRunRegistry.completeRun('app-run-7', { exitCode: 0 });

    const runningSessions = chatRunRegistry.listRunningRuns();
    assert.deepEqual(runningSessions.map((session) => session.sessionId), ['app-run-8']);
    assert.equal(runningSessions[0]?.provider, 'codex');
  });
});

test('replayEvents returns only events after the requested seq', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-4', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-4',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'x', content: 'a' });
    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'x', content: 'b' });
    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'x', content: 'c' });

    const replayed = chatRunRegistry.replayEvents('app-run-4', 1);
    assert.deepEqual(replayed.map((event) => event.content), ['b', 'c']);
    assert.deepEqual(replayed.map((event) => event.seq), [2, 3]);
  });
});

test('attachConnection adds a socket without cutting off the ones already watching', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-5', 'opencode', '/workspace/demo');
    const firstConnection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-5',
      provider: 'opencode',
      providerSessionId: null,
      connection: firstConnection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({ kind: 'stream_delta', provider: 'opencode', sessionId: 'o', content: 'before' });

    // A second tab on the same session subscribes mid-run.
    const secondConnection = new FakeConnection();
    assert.equal(chatRunRegistry.attachConnection('app-run-5', secondConnection), true);
    run.writer.send({ kind: 'stream_delta', provider: 'opencode', sessionId: 'o', content: 'after' });

    assert.deepEqual(firstConnection.frames.map((frame) => frame.content), ['before', 'after']);
    assert.deepEqual(secondConnection.frames.map((frame) => frame.content), ['after']);
  });
});

test('a refreshed tab stops receiving once its old socket is closed', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-5b', 'opencode', '/workspace/demo');
    const staleConnection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-5b',
      provider: 'opencode',
      providerSessionId: null,
      connection: staleConnection,
      userId: null,
    });
    assert.ok(run);

    // The page reloads: the original socket closes and the fresh one subscribes.
    staleConnection.readyState = 3;
    const reloadedConnection = new FakeConnection();
    assert.equal(chatRunRegistry.attachConnection('app-run-5b', reloadedConnection), true);

    run.writer.send({ kind: 'stream_delta', provider: 'opencode', sessionId: 'o', content: 'after' });
    run.writer.send({ kind: 'stream_delta', provider: 'opencode', sessionId: 'o', content: 'later' });

    assert.deepEqual(staleConnection.frames, []);
    assert.deepEqual(reloadedConnection.frames.map((frame) => frame.content), ['after', 'later']);
  });
});

test('startRun rejects a second concurrent run for the same session', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-6', 'opencode', '/workspace/demo');
    const connection = new FakeConnection();
    const first = chatRunRegistry.startRun({
      appSessionId: 'app-run-6',
      provider: 'opencode',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(first);

    const second = chatRunRegistry.startRun({
      appSessionId: 'app-run-6',
      provider: 'opencode',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.equal(second, null);

    // After the run finishes a new one is allowed again.
    chatRunRegistry.completeRun('app-run-6', { exitCode: 0 });
    const third = chatRunRegistry.startRun({
      appSessionId: 'app-run-6',
      provider: 'opencode',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(third);
  });
});
