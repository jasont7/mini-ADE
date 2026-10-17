import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionVoiceSettingsDb } from '@/modules/database/repositories/session-voice-settings.db.js';

test('stores voice settings per session without a sessions row', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'voice-settings-db-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    assert.equal(sessionVoiceSettingsDb.get('new-chat'), null);
    sessionVoiceSettingsDb.upsert({ sessionId: 'new-chat', mode: 'gemini', geminiVoice: 'Kore' });
    sessionVoiceSettingsDb.upsert({ sessionId: 'new-chat', mode: 'private', geminiVoice: null });
    assert.deepEqual(sessionVoiceSettingsDb.get('new-chat'), {
      sessionId: 'new-chat', mode: 'private', geminiVoice: null,
    });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
