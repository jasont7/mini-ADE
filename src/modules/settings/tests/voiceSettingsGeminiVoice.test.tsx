import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import VoiceSettingsTab from '@/modules/settings/tabs/VoiceSettingsTab';
import { readGeminiVoice } from '@/shared/voiceConfig';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/shared/context/UiPreferencesContext', () => ({
  useUiPreferences: () => ({ voiceEnabled: false }),
  useSetUiPreference: () => () => undefined,
}));

let geminiStatus: Record<string, unknown>;

beforeEach(() => {
  localStorage.clear();
  geminiStatus = {
    configured: true, reason: null, model: 'm', nonBlockingTools: false, voices: ['Kore', 'Puck'], defaultVoice: 'Kore',
  };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(geminiStatus), { status: 200 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test('the Gemini Live voice select saves the chosen voice for new voice sessions', async () => {
  render(<VoiceSettingsTab />);
  const select = await screen.findByRole('combobox');
  assert.equal((select as HTMLSelectElement).value, '');
  fireEvent.change(select, { target: { value: 'Puck' } });
  assert.equal(readGeminiVoice(), 'Puck');
  fireEvent.change(select, { target: { value: '' } });
  assert.equal(readGeminiVoice(), null);
});

test('the select is hidden when Gemini Live is not configured', async () => {
  geminiStatus = { ...geminiStatus, configured: false };
  render(<VoiceSettingsTab />);
  await waitFor(() => assert.equal((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length, 1));
  assert.equal(screen.queryByRole('combobox'), null);
});
