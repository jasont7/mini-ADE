import { Mic, MicOff, PhoneOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PHASE_DOT } from '@/modules/chat/composer/VoiceButtons';
import { useLiveVoiceController } from '@/modules/chat/context/LiveVoiceContext';

/**
 * Rendered by the project-workspace shell so the app's live voice always has a
 * visible state with Mute and End, whichever session or tab is open. Names the
 * voice session it is attached to, and clicking the name goes back to it.
 * Shows nothing while no live voice runs.
 */
export default function VoiceStatusControl() {
  const { t } = useTranslation('chat');
  const live = useLiveVoiceController();
  if (!live.running) return null;

  const phase = live.snapshot?.phase ?? 'connecting';
  const muted = Boolean(live.snapshot?.muted);
  const buttonClass = 'flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground max-md:h-9 max-md:w-9';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('liveVoice.stateLabel')}
      className="pointer-events-auto fixed right-3 top-2 z-[60] flex flex-col items-end gap-0.5"
    >
      <div className="flex items-center gap-1 rounded-full border border-border bg-background/95 py-0.5 pl-2.5 pr-0.5 text-xs shadow-md backdrop-blur">
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${PHASE_DOT[phase]}`} />
      {live.voiceSession?.name ? (
        <button
          type="button"
          title={t('liveVoice.openVoiceSession')}
          disabled={!live.voiceSession.sessionId}
          className="max-w-[10rem] truncate rounded px-1 font-medium hover:underline max-md:max-w-[7rem]"
          onClick={live.openVoiceSession}
        >
          {live.voiceSession.name}
        </button>
      ) : null}
      <span className="mr-1 select-none text-muted-foreground">{t(`liveVoice.phase.${phase}`)}</span>
      <button
        type="button"
        aria-label={muted ? t('liveVoice.unmute') : t('liveVoice.mute')}
        aria-pressed={muted}
        className={buttonClass}
        onClick={() => live.setMuted(!muted)}
      >
        {muted ? <MicOff className="h-3.5 w-3.5 text-red-500" /> : <Mic className="h-3.5 w-3.5" />}
      </button>
      <button type="button" aria-label={t('liveVoice.end')} className={buttonClass} onClick={live.stop}>
        <PhoneOff className="h-3.5 w-3.5" />
      </button>
      </div>
      {live.voiceSession && (
        <span className="max-w-[16rem] rounded bg-background/90 px-1.5 py-0.5 text-right text-[10px] leading-3 text-muted-foreground">
          {t('liveVoice.geminiPrivacy')}
        </span>
      )}
    </div>
  );
}
