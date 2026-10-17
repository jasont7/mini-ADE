import assert from 'node:assert/strict';

import { test } from 'vitest';

import { buildVoiceSessionEntries } from '@/modules/project-workspace/utils/voiceSessionEntries';
import type { Project } from '@/shared/types';

const project = (displayName: string, sessions: Project['sessions']): Project => ({
  projectId: displayName,
  displayName,
  fullPath: `/p/${displayName}`,
  sessions,
});

test('flattens every project into entries named as the sidebar names them', () => {
  const entries = buildVoiceSessionEntries([
    project('life', [
      { id: 'a', summary: 'Bikes', name: 'ignored', __provider: 'codex' },
      { id: 'b', name: 'Fallback name' },
      { id: 'c' },
    ]),
    project('empty', undefined),
    project('business', [{ id: 'd', summary: 'Letter' }]),
  ]);
  assert.deepEqual(entries, [
    { id: 'a', name: 'Bikes', projectName: 'life', provider: 'codex' },
    { id: 'b', name: 'Fallback name', projectName: 'life', provider: undefined },
    { id: 'c', name: 'Untitled session', projectName: 'life', provider: undefined },
    { id: 'd', name: 'Letter', projectName: 'business', provider: undefined },
  ]);
});
