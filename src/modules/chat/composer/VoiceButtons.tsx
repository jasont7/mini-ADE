import { AudioLines, Loader2, Mic, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PromptInputButton } from '@/modules/chat/composer/PromptInput';
import type { LiveVoiceController } from '@/modules/chat/hooks/useLiveVoice';
import type { LiveVoicePhase, VoiceInputState } from '@/shared/types';

/** Dot colour per live voice phase. Also used by the always-visible voice status control. */
export const PHASE_DOT: Record<LiveVoicePhase, string> = {
  connecting: 'bg-amber-400',
  listening: 'bg-green-500',
  thinking: 'bg-blue-500 animate-pulse',
  speaking: 'bg-purple-500 animate-pulse',
  error: 'bg-red-500',
};

type Props = {
  voiceState: VoiceInputState;
  voiceToggle: () => void;
  voiceError?: string | null;
  /** Whether push-to-talk dictation can run (the local speech server is configured). */
  dictationAvailable: boolean;
  live: LiveVoiceController;
};

// Both buttons stay at least 40 px square on narrow screens.
const PHONE_SIZE = 'max-md:h-10 max-md:w-10';

/**
 * Rendered by chat's ChatComposer in place of a bare mic button. Two buttons
 * side by side: Dictate (tap to record, tap to stop, the transcript goes into
 * the message box) and Gemini Live (tap to attach to the open session, tap
 * again to end). Mute and End while it runs live in the voice status pill.
 */
export default function VoiceButtons({ voiceState, voiceToggle, voiceError, dictationAvailable, live }: Props) {
  const { t } = useTranslation('chat');

  const phase = live.running ? live.snapshot?.phase ?? 'connecting' : null;
  const geminiReason = !live.geminiAvailable
    ? live.geminiReason ?? t('liveVoice.geminiUnavailable')
    : live.geminiNeedsSession ? t('liveVoice.geminiNeedsSession') : null;
  // Ending a running session stays possible even if availability changes under it.
  const geminiBlocked = !live.running && geminiReason !== null;
  const geminiLabel = live.running
    ? `${t('liveVoice.end')} (${t(`liveVoice.phase.${phase ?? 'connecting'}`)})`
    : geminiReason ?? `${t('liveVoice.modes.gemini')}. ${t('liveVoice.audioToGoogle')}`;

  const dictateIcon = voiceState === 'recording' ? (
    <Square className="text-red-500" />
  ) : voiceState === 'transcribing' ? (
    <Loader2 className="animate-spin" />
  ) : (
    <Mic />
  );
  const dictateLabel = live.running
    ? t('liveVoice.dictateWhileLive')
    : voiceState === 'recording' ? t('voice.stopRecording') : t('voice.input');

  return (
    <>
      {dictationAvailable && (
        <span className="relative inline-flex">
          {voiceError && (
            <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-red-600 px-2 py-1 text-xs text-white shadow-lg">
              {voiceError}
            </span>
          )}
          <PromptInputButton
            tooltip={{ content: dictateLabel }}
            aria-label={dictateLabel}
            aria-disabled={live.running}
            className={`${PHONE_SIZE} ${live.running ? 'opacity-50' : ''}`}
            onClick={(event: { preventDefault: () => void }) => {
              event.preventDefault();
              if (!live.running) voiceToggle();
            }}
          >
            {dictateIcon}
          </PromptInputButton>
        </span>
      )}

      <span className="relative inline-flex">
        {/* aria-disabled rather than disabled, so the tooltip still shows the reason. */}
        <PromptInputButton
          tooltip={{ content: geminiLabel }}
          aria-label={geminiLabel}
          aria-pressed={live.running}
          aria-disabled={geminiBlocked}
          className={`${PHONE_SIZE} ${live.running ? 'bg-accent text-foreground' : ''} ${geminiBlocked ? 'opacity-50' : ''}`}
          onClick={(event: { preventDefault: () => void }) => {
            event.preventDefault();
            if (geminiBlocked) return;
            live.select(live.running ? 'off' : 'gemini');
          }}
        >
          <AudioLines />
        </PromptInputButton>
        {phase && (
          <span
            aria-hidden
            data-testid="gemini-phase-dot"
            data-phase={phase}
            className={`pointer-events-none absolute right-0.5 top-0.5 h-2 w-2 rounded-full ${PHASE_DOT[phase]}`}
          />
        )}
      </span>
    </>
  );
}
