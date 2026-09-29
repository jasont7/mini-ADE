import { useTranslation } from 'react-i18next';

import type { BackgroundTask } from '@/shared/types';

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

  if (tasks.length === 0) return null;

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
    ...tasks.map((task) => `• ${task.description || task.id}`),
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
      </div>
    </div>
  );
}
