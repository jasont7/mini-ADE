import { memo, useState } from 'react';
import { Loader2, Mic, MoreHorizontal } from 'lucide-react';
import type { TFunction } from 'i18next';

import { LLMProviderLogo } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { LLMProvider, Project, ProjectAppearance, SessionWithProvider } from '@/shared/types';
import { createSessionViewModel, formatCompactAge } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';
import ProjectMonogram from '@/modules/sidebar/ProjectMonogram';
import SessionOptions from '@/modules/sidebar/SessionOptions';
import SessionOptionsSheet from '@/modules/sidebar/modals/SessionOptionsSheet';

type SessionPaneRowProps = {
  session: SessionWithProvider;
  project: Project;
  isSelected: boolean;
  isRunning: boolean;
  isUnread: boolean;
  /** True for a voice session, which gets a small mic mark beside its name. */
  isVoice: boolean;
  /** Tag the row with its project; on in the all-projects scope. */
  showProject: boolean;
  /** The project's chosen tile icon and colour, drawn in the project tag. */
  projectAppearance: ProjectAppearance | null;
  currentTime: Date;
  /** Resolved for this row, so a rename keystroke only redraws the row being renamed. */
  isEditing: boolean;
  renameDraft: string;
  onSelect: (session: SessionWithProvider, project: Project) => void;
  onRenameDraftChange: (draft: string) => void;
  onStartEditingSession: (projectId: string, sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectId: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  onForkSession: (session: SessionWithProvider) => void;
  t: TFunction;
};

/** Rendered by SessionPane for one session: provider, title, state and age, with its options menu. */
function SessionPaneRow({
  session,
  project,
  isSelected,
  isRunning,
  isUnread,
  isVoice,
  showProject,
  projectAppearance,
  currentTime,
  isEditing,
  renameDraft,
  onSelect,
  onRenameDraftChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onDeleteSession,
  onForkSession,
  t,
}: SessionPaneRowProps) {
  const isCompact = useCompactSidebar();
  // The bottom sheet is this row's own overlay on touch layouts; nothing else
  // needs to know whether it is open.
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const { sessionName, sessionTime } = createSessionViewModel(session, t);
  const age = formatCompactAge(sessionTime, currentTime);

  const status = isRunning ? (
    <Loader2
      aria-label={t('tooltips.processingSessionIndicator', 'Processing session')}
      className="activity-indicator h-3.5 w-3.5 animate-spin text-blue-500"
    />
  ) : (
    <span className="flex items-center gap-1.5">
      {isUnread && (
        <span
          role="status"
          aria-label={t('tooltips.unreadIndicator', { defaultValue: 'New response' })}
          className="h-2 w-2 rounded-full bg-green-500"
        />
      )}
      {age && <time className="text-[11px] tabular-nums text-muted-foreground">{age}</time>}
    </span>
  );

  const body = (
    <>
      <span className="mt-px flex h-4 w-4 flex-shrink-0 items-center justify-center">
        <LLMProviderLogo provider={session.__provider} className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1">
          {isVoice && (
            <Mic
              aria-label={t('sessions.voiceMark', 'Voice session')}
              className="h-3 w-3 flex-shrink-0 text-muted-foreground"
            />
          )}
          <span
            className={cn(
              'block truncate text-[13px] leading-5',
              isUnread || isSelected ? 'font-medium text-foreground' : 'text-foreground/85',
            )}
            title={sessionName}
          >
            {sessionName}
          </span>
        </span>
        {showProject && (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <ProjectMonogram projectId={project.projectId} name={project.displayName} appearance={projectAppearance} size="xs" />
            <span className="truncate">{project.displayName}</span>
          </span>
        )}
      </span>
    </>
  );

  if (isCompact) {
    return (
      <div
        className={cn(
          'flex min-h-12 items-center gap-1 rounded-lg pl-3 pr-1 transition-colors active:bg-accent',
          isSelected && 'bg-accent',
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2.5 py-2.5 text-left"
          onClick={() => onSelect(session, project)}
        >
          {body}
          <span className="mt-0.5 flex-shrink-0">{status}</span>
        </button>
        <button
          type="button"
          aria-label={`Session options for ${sessionName}`}
          aria-haspopup="dialog"
          aria-expanded={isSheetOpen}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-muted"
          onClick={() => setIsSheetOpen(true)}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        <SessionOptionsSheet
          open={isSheetOpen}
          onOpenChange={(open) => {
            setIsSheetOpen(open);
            if (!open && isEditing) {
              onCancelEditingSession();
            }
          }}
          sessionId={session.id}
          sessionName={sessionName}
          provider={session.__provider}
          isProcessing={isRunning}
          isEditing={isEditing}
          renameDraft={renameDraft}
          onRenameDraftChange={onRenameDraftChange}
          onStartRename={() => onStartEditingSession(project.projectId, session.id, sessionName)}
          onSaveRename={() => {
            onSaveEditingSession(project.projectId, session.id, renameDraft, session.__provider);
            setIsSheetOpen(false);
          }}
          onCancelRename={onCancelEditingSession}
          onDelete={() => onDeleteSession(session.id, sessionName)}
          onFork={() => onForkSession({ ...session, __projectId: project.projectId })}
        />
      </div>
    );
  }

  return (
    <div className="group relative">
      <a
        href={`/session/${session.id}`}
        className={cn(
          'flex w-full items-start gap-2.5 rounded-lg py-1.5 pl-2.5 pr-2 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          isSelected ? 'bg-accent' : 'hover:bg-accent/50',
        )}
        aria-current={isSelected ? 'page' : undefined}
        // Plain clicks stay in the app; modified clicks and the native context
        // menu use the href to open a new tab or window.
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onSelect(session, project);
        }}
      >
        {body}
        <span
          className={cn(
            'mt-0.5 flex h-4 flex-shrink-0 items-center transition-opacity duration-150',
            isEditing ? 'opacity-0' : 'group-hover:opacity-0',
          )}
        >
          {status}
        </span>
      </a>
      <SessionOptions
        className={cn(
          'absolute right-1 top-1 transition-opacity duration-150',
          isEditing ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100',
        )}
        sessionId={session.id}
        sessionName={sessionName}
        provider={session.__provider}
        projectId={project.projectId}
        isProcessing={isRunning}
        isEditing={isEditing}
        renameDraft={renameDraft}
        onRenameDraftChange={onRenameDraftChange}
        onStartEditingSession={onStartEditingSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        onDeleteSession={onDeleteSession}
        onFork={() => onForkSession({ ...session, __projectId: project.projectId })}
        t={t}
      />
    </div>
  );
}

/**
 * Memoized: websocket session deltas re-render the navigator every 0.5-2s
 * during a run. Session objects come from getAllSessions' per-project cache
 * and the pane's callbacks are stable, so untouched rows bail out.
 */
export default memo(SessionPaneRow);
