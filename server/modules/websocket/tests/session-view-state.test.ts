import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sessionViewStateService } from '@/modules/websocket/services/session-view-state.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-view-state-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    sessionViewStateService.clearAll();
    connectedClients.clear();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const isUnread = (sessionId: string): boolean => {
  const row = sessionsDb.getSessionById(sessionId);
  assert.ok(row);
  return Boolean(row.last_completed_at && (!row.last_viewed_at || row.last_completed_at > row.last_viewed_at));
};

test('a run finishing while nobody is looking leaves the session unread', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-1', 'claude', '/workspace/demo');
    const phone = new FakeConnection();
    connectedClients.add(phone as never);

    sessionViewStateService.recordRunCompleted('app-1');

    assert.equal(isUnread('app-1'), true);
    const event = phone.frames.at(-1);
    assert.equal(event?.kind, 'session_view_state');
    assert.equal(event?.sessionId, 'app-1');
    assert.ok(event?.lastCompletedAt);
  });
});

test('a run finishing while any device has it on screen is read on arrival', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-1', 'claude', '/workspace/demo');
    const laptop = new FakeConnection();
    connectedClients.add(laptop as never);

    sessionViewStateService.setViewedSession(laptop as never, 'app-1');
    sessionViewStateService.recordRunCompleted('app-1');

    assert.equal(isUnread('app-1'), false);
  });
});

test('opening an unread session on one device marks it read for all of them', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-1', 'claude', '/workspace/demo');
    const laptop = new FakeConnection();
    const phone = new FakeConnection();
    connectedClients.add(laptop as never);
    connectedClients.add(phone as never);

    sessionViewStateService.recordRunCompleted('app-1');
    assert.equal(isUnread('app-1'), true);

    // ISO strings compare by the millisecond, so let the clock move.
    await new Promise((resolve) => setTimeout(resolve, 5));
    sessionViewStateService.setViewedSession(phone as never, 'app-1');

    assert.equal(isUnread('app-1'), false);
    const lastLaptopEvent = laptop.frames.at(-1);
    assert.equal(lastLaptopEvent?.kind, 'session_view_state');
    assert.ok(lastLaptopEvent?.lastViewedAt, 'the other device hears about the view');
  });
});

test('closing the socket stops counting it as on screen', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-1', 'claude', '/workspace/demo');
    const laptop = new FakeConnection();
    connectedClients.add(laptop as never);

    sessionViewStateService.setViewedSession(laptop as never, 'app-1');
    sessionViewStateService.dropConnection(laptop as never);
    await new Promise((resolve) => setTimeout(resolve, 5));
    sessionViewStateService.recordRunCompleted('app-1');

    assert.equal(isUnread('app-1'), true);
  });
});
