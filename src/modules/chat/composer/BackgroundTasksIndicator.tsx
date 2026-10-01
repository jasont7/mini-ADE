import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { BackgroundTask } from '@/shared/types';

// Background work runs for hours (model training), so past an hour drop the
// seconds and show hours and minutes.
const formatElapsed = (t: TFunction, elapsedMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return t('claudeStatus.elapsed.hoursMinutes', { hours, minutes, defaultValue: '{{hours}}h {{minutes}}m' });
  }
  if (minutes > 0) {
    return t('claudeStatus.elapsed.minutesSeconds', { minutes, seconds, defaultValue: '{{minutes}}m {{seconds}}s' });
  }
  return t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: '{{count}}s' });
};

type BackgroundTasksIndicatorProps = {
  tasks: BackgroundTask[];
  isInputFocused?: boolean;
};

/**
 * Says work is still running while the session otherwise looks idle: a
 * backgrounded shell, a background agent or a Monitor that outlived its turn.
 * That work can report back and start a turn on its own, so without this the
 * unlocked composer reads as "nothing is happening".
 *
 * Rendered by chat's ChatComposer in the activity indicator's slot, only while
 * no turn is running. Deliberately static where the activity indicator
 * shimmers: nothing is streaming, and sending a message is fine.
 */
export default function BackgroundTasksIndicator({ tasks, isInputFocused = false }: BackgroundTasksIndicatorProps) {
  const { t } = useTranslation('chat');
  const [now, setNow] = useState(() => Date.now());
  const hasTimer = tasks.some((task) => task.startedAt !== undefined);

  useEffect(() => {
    if (!hasTimer) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasTimer]);

  if (tasks.length === 0) return null;

  const elapsedFor = (task: BackgroundTask): string | null =>
    task.startedAt === undefined ? null : formatElapsed(t, now - task.startedAt);
  // With several tasks, the tab times the one that has run longest.
  const oldestStart = Math.min(...tasks.map((task) => task.startedAt ?? Infinity));
  const tabElapsed = Number.isFinite(oldestStart) ? formatElapsed(t, now - oldestStart) : null;

  const [firstTask] = tasks;
  const label = tasks.length > 1
    ? t('claudeStatus.background.many', { count: tasks.length, defaultValue: '{{count}} background tasks running' })
    : firstTask.description
      ? t('claudeStatus.background.one', { description: firstTask.description, defaultValue: 'Background: {{description}}' })
      : t('claudeStatus.background.unnamed', { defaultValue: 'Background task running' });
  const title = [
    t('claudeStatus.background.title', {
      defaultValue: 'Still running after the last reply. It reports back and continues on its own. You can keep chatting.',
    }),
    ...tasks.map((task) => {
      const elapsed = elapsedFor(task);
      return `• ${task.description || task.id}${elapsed ? ` (${elapsed})` : ''}`;
    }),
  ].join('\n');

  const tabSurfaceClassName = [
    'chat-activity-tab inline-flex h-8 max-w-full items-center gap-2 rounded-b-none rounded-t-lg border border-b-0 bg-card px-3 text-xs text-muted-foreground transition-all duration-200',
    isInputFocused
      ? 'border-primary/30 shadow-[0_-1px_2px_hsl(var(--foreground)/0.08),1px_0_2px_hsl(var(--foreground)/0.06),-1px_0_2px_hsl(var(--foreground)/0.06)]'
      : 'border-border/50 shadow-[0_-1px_1px_hsl(var(--foreground)/0.04),1px_0_1px_hsl(var(--foreground)/0.03),-1px_0_1px_hsl(var(--foreground)/0.03)]',
  ].join(' ');

  return (
    <div className="chat-activity-enter flex items-end bg-transparent">
      <div className={`${tabSurfaceClassName} pointer-events-auto`} title={title} role="status">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
        <span className="truncate">{label}</span>
        {tabElapsed && <span className="shrink-0 tabular-nums text-muted-foreground/60">{tabElapsed}</span>}
      </div>
    </div>
  );
}
