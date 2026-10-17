import { useCallback, useRef, useState } from 'react';
import type { ComponentProps, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ChatInterface } from '@/modules/chat';
import { LLMProviderLogo } from '@/shared/ui';
import { cn, getSessionTitle } from '@/shared/utils';
import type {
  Project,
  ProjectSession,
  RealtimeProps,
  SessionEstablishedContext,
  SessionNavigationOptions,
  SettingsMainTab,
  SplitPaneId,
} from '@/shared/types';
import type { useProjectSplitViewState } from '@/modules/project-workspace/context/ProjectsStateContext';
import WorkspaceErrorBoundary from '@/modules/project-workspace/WorkspaceErrorBoundary';

type SplitView = ReturnType<typeof useProjectSplitViewState>;

type WorkspaceChatPanesProps = RealtimeProps & {
  isActive: boolean;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  splitView: SplitView;
  onFileOpen: ComponentProps<typeof ChatInterface>['onFileOpen'];
  onNavigateToSession: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  onSessionEstablished: (sessionId: string, context: SessionEstablishedContext) => void;
  onSecondarySessionEstablished: (sessionId: string, context: SessionEstablishedContext) => void;
  onShowSettings: (tab?: SettingsMainTab) => void;
  showRawParameters: boolean;
  showThinking: boolean;
  sendByCtrlEnter: boolean;
  externalMessageUpdate: number;
  newSessionTrigger: number;
  onShowAllTasks: (() => void) | null;
};

const DIVIDER_KEYBOARD_STEP = 0.05;

/**
 * Rendered by WorkspaceMain for the Chat view: one chat, or two side by side in
 * split view. The left chat keeps the same position in the tree either way, so
 * opening or closing the split never remounts it.
 */
export default function WorkspaceChatPanes({
  isActive,
  selectedProject,
  selectedSession,
  splitView,
  ws,
  sendMessage,
  onFileOpen,
  onNavigateToSession,
  onSessionEstablished,
  onSecondarySessionEstablished,
  onShowSettings,
  showRawParameters,
  showThinking,
  sendByCtrlEnter,
  externalMessageUpdate,
  newSessionTrigger,
  onShowAllTasks,
}: WorkspaceChatPanesProps) {
  const { t } = useTranslation();
  const {
    isSplitActive,
    focusedPane,
    dividerRatio,
    setDividerRatio,
    focusPane,
    closeSplit,
    showInSecondary,
    secondaryProject,
    secondarySession,
    isSecondaryResolving,
    secondaryNewSessionTrigger,
  } = splitView;

  const containerRef = useRef<HTMLDivElement>(null);
  // The divider position while a drag is in progress. Committed to split-view
  // state (and storage) once, on release, rather than on every pointer move.
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const shownRatio = dragRatio ?? dividerRatio;

  const ratioFromPointer = (clientX: number): number | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    return Math.min(0.75, Math.max(0.25, (clientX - rect.left) / rect.width));
  };

  const handleDividerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragRatio(dividerRatio);
  };

  const handleDividerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRatio === null) return;
    const next = ratioFromPointer(event.clientX);
    if (next !== null) setDragRatio(next);
  };

  const handleDividerPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRatio === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDividerRatio(dragRatio);
    setDragRatio(null);
  };

  const handleDividerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setDividerRatio(dividerRatio + (event.key === 'ArrowLeft' ? -DIVIDER_KEYBOARD_STEP : DIVIDER_KEYBOARD_STEP));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setDividerRatio(0.5);
    }
  };

  const handleSecondaryNavigate = useCallback((targetSessionId: string) => {
    showInSecondary(targetSessionId);
  }, [showInSecondary]);

  const focusPrimary = useCallback(() => focusPane('primary'), [focusPane]);
  const focusSecondary = useCallback(() => focusPane('secondary'), [focusPane]);

  return (
    <div ref={containerRef} className={cn('flex h-full min-h-0', dragRatio !== null && 'cursor-col-resize select-none')}>
      <div
        className="flex min-h-0 min-w-0 flex-col"
        style={isSplitActive ? { width: `${shownRatio * 100}%` } : { width: '100%' }}
        onPointerDownCapture={isSplitActive ? focusPrimary : undefined}
        onFocusCapture={isSplitActive ? focusPrimary : undefined}
        data-split-pane={isSplitActive ? 'primary' : undefined}
      >
        {isSplitActive && (
          <ChatPaneHeader
            pane="primary"
            isFocused={focusedPane === 'primary'}
            project={selectedProject}
            session={selectedSession}
          />
        )}
        <div className="min-h-0 flex-1">
          <WorkspaceErrorBoundary showDetails>
            <ChatInterface
              isActive={isActive}
              isFocused={focusedPane === 'primary'}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              ws={ws}
              sendMessage={sendMessage}
              onFileOpen={onFileOpen}
              onNavigateToSession={onNavigateToSession}
              onSessionEstablished={onSessionEstablished}
              onShowSettings={onShowSettings}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              sendByCtrlEnter={sendByCtrlEnter}
              externalMessageUpdate={externalMessageUpdate}
              newSessionTrigger={newSessionTrigger}
              onShowAllTasks={onShowAllTasks}
            />
          </WorkspaceErrorBoundary>
        </div>
      </div>

      {isSplitActive && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('splitView.resize', { defaultValue: 'Resize split view' })}
            aria-valuemin={25}
            aria-valuemax={75}
            aria-valuenow={Math.round(shownRatio * 100)}
            tabIndex={0}
            title={t('splitView.resizeHint', { defaultValue: 'Drag to resize, double-click to reset' })}
            onPointerDown={handleDividerPointerDown}
            onPointerMove={handleDividerPointerMove}
            onPointerUp={handleDividerPointerUp}
            onPointerCancel={handleDividerPointerUp}
            onDoubleClick={() => setDividerRatio(0.5)}
            onKeyDown={handleDividerKeyDown}
            className="group relative w-px flex-shrink-0 cursor-col-resize bg-border/70 outline-none"
          >
            {/* Wider invisible hit area, so the 1px line is easy to grab. */}
            <span className="absolute inset-y-0 -left-1.5 -right-1.5 z-10" />
            <span
              className={cn(
                'absolute inset-y-0 -left-px -right-px transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary/70',
                dragRatio !== null && 'bg-primary/70',
              )}
            />
          </div>

          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            onPointerDownCapture={focusSecondary}
            onFocusCapture={focusSecondary}
            data-split-pane="secondary"
          >
            <ChatPaneHeader
              pane="secondary"
              isFocused={focusedPane === 'secondary'}
              project={secondaryProject}
              session={secondarySession}
              onClose={closeSplit}
            />
            <div className="min-h-0 flex-1">
              {isSecondaryResolving ? (
                <PanePlaceholder>{t('splitView.loading', { defaultValue: 'Opening session…' })}</PanePlaceholder>
              ) : (
                <WorkspaceErrorBoundary showDetails>
                  <ChatInterface
                    isActive={isActive}
                    isFocused={focusedPane === 'secondary'}
                    selectedProject={secondaryProject}
                    selectedSession={secondarySession}
                    ws={ws}
                    sendMessage={sendMessage}
                    onFileOpen={onFileOpen}
                    onNavigateToSession={handleSecondaryNavigate}
                    onSessionEstablished={onSecondarySessionEstablished}
                    onShowSettings={onShowSettings}
                    showRawParameters={showRawParameters}
                    showThinking={showThinking}
                    sendByCtrlEnter={sendByCtrlEnter}
                    externalMessageUpdate={externalMessageUpdate}
                    newSessionTrigger={secondaryNewSessionTrigger}
                    onShowAllTasks={onShowAllTasks}
                  />
                </WorkspaceErrorBoundary>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type ChatPaneHeaderProps = {
  pane: SplitPaneId;
  isFocused: boolean;
  project: Project | null;
  session: ProjectSession | null;
  onClose?: () => void;
};

/** A split pane's title strip. The focused pane gets the accent bar and full-strength text. */
function ChatPaneHeader({ pane, isFocused, project, session, onClose }: ChatPaneHeaderProps) {
  const { t } = useTranslation();
  const title = session ? getSessionTitle(session) : t('mainContent.newSession');

  return (
    <div
      className={cn(
        'relative flex h-9 flex-shrink-0 items-center gap-2 border-b border-border/60 px-3',
        isFocused ? 'bg-background' : 'bg-muted/30',
      )}
      data-focused={isFocused ? 'true' : 'false'}
      aria-label={pane === 'primary'
        ? t('splitView.leftPane', { defaultValue: 'Left chat' })
        : t('splitView.rightPane', { defaultValue: 'Right chat' })}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-x-0 top-0 h-0.5', isFocused ? 'bg-primary' : 'bg-transparent')}
      />
      {session && <LLMProviderLogo provider={session.__provider} className="h-3.5 w-3.5 flex-shrink-0" />}
      <div className={cn('flex min-w-0 flex-1 items-baseline gap-2', !isFocused && 'opacity-60')}>
        <span title={title} className="truncate text-xs font-semibold text-foreground">{title}</span>
        {project && (
          <span className="hidden truncate text-[11px] text-muted-foreground xl:inline">{project.displayName}</span>
        )}
      </div>
      {isFocused && (
        <span className="flex-shrink-0 text-[10px] font-medium uppercase tracking-wide text-primary">
          {t('splitView.focused', { defaultValue: 'Focused' })}
        </span>
      )}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('splitView.close', { defaultValue: 'Close split view' })}
          title={t('splitView.close', { defaultValue: 'Close split view' })}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function PanePlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{children}</div>
  );
}
