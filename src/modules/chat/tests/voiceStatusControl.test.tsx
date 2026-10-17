import assert from 'node:assert/strict';

import { act, render, screen } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import VoiceStatusControl from '@/modules/chat/VoiceStatusControl';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const controller = vi.hoisted(() => ({
  value: {
    running: false,
    snapshot: null as null | { phase: string; muted: boolean; error: null },
    voiceSession: null as null | { sessionId: string | null; name: string; projectName: string | null },
    setMuted: vi.fn(),
    stop: vi.fn(),
    openVoiceSession: vi.fn(),
  },
}));
vi.mock('@/modules/chat/context/LiveVoiceContext', () => ({ useLiveVoiceController: () => controller.value }));

beforeEach(() => {
  controller.value = { running: false, snapshot: null, voiceSession: null, setMuted: vi.fn(), stop: vi.fn(), openVoiceSession: vi.fn() };
});

test('shows nothing while no voice runs', () => {
  const { container } = render(<VoiceStatusControl />);
  assert.equal(container.firstChild, null);
});

test('shows the phase with Mute and End while the voice runs', () => {
  controller.value = { ...controller.value, running: true, snapshot: { phase: 'speaking', muted: false, error: null } };
  render(<VoiceStatusControl />);
  assert.ok(screen.getByText('liveVoice.phase.speaking'));
  act(() => screen.getByRole('button', { name: 'liveVoice.mute' }).click());
  assert.deepEqual(controller.value.setMuted.mock.calls, [[true]]);
  act(() => screen.getByRole('button', { name: 'liveVoice.end' }).click());
  assert.equal(controller.value.stop.mock.calls.length, 1);
});

test('shows Connecting before the first snapshot, and offers Unmute when muted', () => {
  controller.value = { ...controller.value, running: true, snapshot: null };
  const { rerender } = render(<VoiceStatusControl />);
  assert.ok(screen.getByText('liveVoice.phase.connecting'));
  controller.value = { ...controller.value, snapshot: { phase: 'listening', muted: true, error: null } };
  rerender(<VoiceStatusControl />);
  assert.ok(screen.getByRole('button', { name: 'liveVoice.unmute' }));
});

test('names the voice session, goes back to it on click, and states the privacy line', () => {
  controller.value = {
    ...controller.value,
    running: true,
    snapshot: { phase: 'listening', muted: false, error: null },
    voiceSession: { sessionId: 's1', name: 'Voice, Oct 11 15:40', projectName: 'life' },
  };
  render(<VoiceStatusControl />);
  act(() => screen.getByRole('button', { name: 'Voice, Oct 11 15:40' }).click());
  assert.equal(controller.value.openVoiceSession.mock.calls.length, 1);
  assert.ok(screen.getByText('liveVoice.geminiPrivacy'));
});

test('the name is not clickable before the session has an id', () => {
  controller.value = {
    ...controller.value,
    running: true,
    voiceSession: { sessionId: null, name: 'Voice, Oct 11 15:40', projectName: 'life' },
  };
  render(<VoiceStatusControl />);
  assert.equal((screen.getByRole('button', { name: 'Voice, Oct 11 15:40' }) as HTMLButtonElement).disabled, true);
});
