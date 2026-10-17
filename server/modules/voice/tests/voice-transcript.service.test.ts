import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, voiceTranscriptDb } from '@/modules/database/index.js';

import { createVoiceTranscriptService } from '../voice-transcript.service.js';

async function withService(run: (service: ReturnType<typeof createVoiceTranscriptService>, directory: string) => Promise<void>) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'voice-transcript-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  const directory = path.join(tempDirectory, 'voice-transcripts');
  try {
    await run(createVoiceTranscriptService({ store: voiceTranscriptDb, directory }), directory);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const entry = (id: string, role: string, text: string, at: number) => ({ id, role, text, at });

test('appends entries and lists them oldest first, with ties kept in saved order', async () => {
  await withService(async (service) => {
    await service.append('s1', [entry('b', 'gemini', 'Hello Jason', 2000), entry('a', 'user', 'Hi there', 1000)]);
    await service.append('s1', [entry('c', 'tool', 'Asked Claude: list files', 2000)]);
    const listed = service.list('s1');
    assert.ok(listed.ok);
    assert.deepEqual(listed.value.map((item) => item.id), ['a', 'b', 'c']);
  });
});

test('a retried write is stored once and other sessions stay apart', async () => {
  await withService(async (service) => {
    const first = await service.append('s1', [entry('a', 'user', 'Hi', 1)]);
    const again = await service.append('s1', [entry('a', 'user', 'Hi', 1)]);
    await service.append('s2', [entry('x', 'user', 'Other', 1)]);
    assert.deepEqual([first, again], [{ ok: true, value: { added: 1 } }, { ok: true, value: { added: 0 } }]);
    const listed = service.list('s1');
    assert.ok(listed.ok && listed.value.length === 1);
  });
});

test('entries survive a reload of the database connection', async () => {
  await withService(async (service) => {
    await service.append('s1', [entry('a', 'user', 'Remember me', 5)]);
    closeConnection();
    const listed = service.list('s1');
    assert.ok(listed.ok);
    assert.equal(listed.value[0].text, 'Remember me');
  });
});

test('writes a markdown copy named after the session, one line per entry, once', async () => {
  await withService(async (service, directory) => {
    await service.registerSession('s1', { name: 'Voice, Oct 11 15:40' });
    await service.append('s1', [entry('a', 'user', 'What is\nthe plan?', 1_760_000_000_000), entry('b', 'gemini', 'On it.', 1_760_000_001_000)]);
    await service.append('s1', [entry('a', 'user', 'What is\nthe plan?', 1_760_000_000_000)]);
    const markdown = await readFile(path.join(directory, 's1.md'), 'utf8');
    assert.match(markdown, /^# Voice, Oct 11 15:40/);
    assert.equal((markdown.match(/\*\*You:\*\* What is the plan\?/g) ?? []).length, 1);
    assert.match(markdown, /\*\*Voice:\*\* On it\./);
  });
});

test('registering marks the session as voice and keeps the first name', async () => {
  await withService(async (service) => {
    await service.registerSession('s1', { name: 'First' });
    await service.registerSession('s1', { name: 'Second' });
    assert.deepEqual(service.listSessionIds(), ['s1']);
    assert.equal(voiceTranscriptDb.getVoiceSessionName('s1'), 'First');
  });
});

test('rejects bad session ids and malformed entries', async () => {
  await withService(async (service) => {
    assert.equal((await service.append('../evil', [entry('a', 'user', 'x', 1)])).ok, false);
    assert.equal((await service.registerSession('a/b', {})).ok, false);
    assert.equal((await service.append('s1', [entry('a', 'robot', 'x', 1)])).ok, false);
    assert.equal((await service.append('s1', [entry('a', 'user', '  ', 1)])).ok, false);
    assert.equal((await service.append('s1', 'nope')).ok, false);
  });
});
