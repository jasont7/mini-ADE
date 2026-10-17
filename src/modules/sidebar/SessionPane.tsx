import { memo, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  ChevronRight,
  Copy,
  Edit3,
  Mic,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Smile,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { TFunction } from 'i18next';

import { ActionMenu, Input, ScrollArea } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type {
  ActiveSidebarRename,
  ArchivedProjectListItem,
  ArchivedSessionListItem,
  ConversationSearchResults,
  LLMProvider,
  LoadingProgress,
  Project,
  ProjectActivitySummary,
  ProjectAppearance,
  SearchProgress,
  SessionPaneMode,
  SessionTriageGroup,
  SessionTriageGroupKey,
  SessionWithProvider,
} from '@/shared/types';
import ArchiveList from '@/modules/sidebar/ArchiveList';
import MessageSearchResults from '@/modules/sidebar/MessageSearchResults';
import ProjectIconPicker from '@/modules/sidebar/modals/ProjectIconPicker';
import ProjectMonogram from '@/modules/sidebar/ProjectMonogram';
import SessionPaneRow from '@/modules/sidebar/SessionPaneRow';
import SidebarProjectsState from '@/modules/sidebar/SidebarProjectsState';

const GROUP_LABELS: Record<SessionTriageGroupKey, string> = {
  review: 'Needs review',
  running: 'Running',
  today: 'Today',
  week: 'Past week',
  older: 'Older',
};

const iconButtonClass =
  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

type SessionPaneProps = {
  mode: SessionPaneMode;
  onModeChange: (mode: SessionPaneMode) => void;
  /** The project in scope, or null for every project. */
  scopeProject: Project | null;
  groups: SessionTriageGroup[];
  totalActivity: ProjectActivitySummary;
  selectedSessionId: string | null;
  activeRename: ActiveSidebarRename | null;
  currentTime: Date;
  isMobile: boolean;
  isPWA: boolean;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  projectsCount: number;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  isRefreshing: boolean;
  onRefresh: () => void;
  onCollapse: () => void;
  /** Each project's chosen tile icon and colour, for the header and the rows' project tags. */
  projectAppearance: ReadonlyMap<string, ProjectAppearance>;
  onSetProjectAppearance: (projectId: string, change: Partial<ProjectAppearance>) => void;
  // Project-scope header
  isScopeProjectStarred: boolean;
  isScopeProjectDeleting: boolean;
  hasMoreSessions: boolean;
  isLoadingMoreSessions: boolean;
  onLoadMoreSessions: (projectId: string) => void;
  onNewSession: (project: Project) => void;
  /** Starts Gemini Live in a new voice session of the project. Absent when Gemini Live is not available. */
  onNewVoiceSession?: (project: Project) => void;
  /** Ids of the voice sessions, which get a voice mark in the list. */
  voiceSessionIds: ReadonlySet<string>;
  onToggleStarProject: (projectId: string) => void;
  onStartEditingProject: (project: Project) => void;
  onSaveProjectName: (projectId: string, nextName: string) => void;
  onDeleteProject: (project: Project) => void;
  // Session rows
  onSelectSession: (session: SessionWithProvider, project: Project) => void;
  onRenameDraftChange: (draft: string) => void;
  onCancelRename: () => void;
  onStartEditingSession: (projectId: string, sessionId: string, initialName: string) => void;
  onSaveEditingSession: (projectId: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  onForkSession: (session: SessionWithProvider) => void;
  // Message search
  conversationResults: ConversationSearchResults | null;
  isSearching: boolean;
  searchProgress: SearchProgress | null;
  onConversationResultClick: (projectId: string | null, sessionId: string, provider: string, messageTimestamp?: string | null, messageSnippet?: string | null) => void;
  // Archive
  archivedProjects: ArchivedProjectListItem[];
  archivedSessions: ArchivedSessionListItem[];
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  onRestoreArchivedProject: (projectId: string) => void;
  onArchivedSessionClick: (session: ArchivedSessionListItem) => void;
  onRestoreArchivedSession: (sessionId: string) => void;
  onDeleteArchivedSession: (session: ArchivedSessionListItem) => void;
  t: TFunction;
};

function PaneHeading({ title, subtitle, actions, leading }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; leading?: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      {leading}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-semibold leading-6 tracking-tight text-foreground">{title}</h2>
        {subtitle && <div className="truncate text-xs leading-4 text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  );
}

const describeTotals = ({ running, unread }: ProjectActivitySummary): string => {
  if (running === 0 && unread === 0) return 'Nothing running';
  return [
    running > 0 ? `${running} running` : null,
    unread > 0 ? `${unread} to review` : null,
  ].filter(Boolean).join(', ');
};

/** Rendered by SidebarNavigator beside the rail: the scope's sessions grouped by what needs attention, plus message search and the archive. */
function SessionPane({
  mode,
  onModeChange,
  scopeProject,
  groups,
  totalActivity,
  selectedSessionId,
  activeRename,
  currentTime,
  isMobile,
  isPWA,
  isLoading,
  loadingProgress,
  projectsCount,
  searchFilter,
  onSearchFilterChange,
  isRefreshing,
  onRefresh,
  onCollapse,
  projectAppearance,
  onSetProjectAppearance,
  isScopeProjectStarred,
  isScopeProjectDeleting,
  hasMoreSessions,
  isLoadingMoreSessions,
  onLoadMoreSessions,
  onNewSession,
  onNewVoiceSession,
  voiceSessionIds,
  onToggleStarProject,
  onStartEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSelectSession,
  onRenameDraftChange,
  onCancelRename,
  onStartEditingSession,
  onSaveEditingSession,
  onDeleteSession,
  onForkSession,
  conversationResults,
  isSearching,
  searchProgress,
  onConversationResultClick,
  archivedProjects,
  archivedSessions,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  onRestoreArchivedProject,
  onArchivedSessionClick,
  onRestoreArchivedSession,
  onDeleteArchivedSession,
  t,
}: SessionPaneProps) {
  // Headings the user opened or closed by hand. Absent keys fall back to the
  // default, which folds "Older" away whenever something newer is listed.
  const [groupOverrides, setGroupOverrides] = useState<Partial<Record<SessionTriageGroupKey, boolean>>>({});
  // Whether the scope project's icon and colour picker is open; it is this pane's own overlay.
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const isAllScope = scopeProject === null;
  const query = searchFilter.trim();
  const isRenamingProject = activeRename?.target === 'project' && activeRename.id === scopeProject?.projectId;
  const sessionCount = groups.reduce((count, group) => count + group.sessions.length, 0);

  // Keep the open session on screen when it changes from outside the list
  // (Alt+arrow stepping, the command palette, a URL).
  useEffect(() => {
    if (!selectedSessionId) return;
    const row = listRef.current?.querySelector('[aria-current="page"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedSessionId, scopeProject?.projectId]);

  const isGroupCollapsed = (key: SessionTriageGroupKey): boolean => {
    if (query) return false;
    const override = groupOverrides[key];
    if (override !== undefined) return override;
    return key === 'older' && groups.length > 1;
  };

  const toggleGroup = (key: SessionTriageGroupKey) => {
    setGroupOverrides((previous) => ({ ...previous, [key]: !isGroupCollapsed(key) }));
  };

  const collapseButton = !isMobile && (
    <button type="button" className={iconButtonClass} onClick={onCollapse} title={t('tooltips.hideSidebar')} aria-label={t('tooltips.hideSidebar')}>
      <PanelLeftClose className="h-4 w-4" />
    </button>
  );

  const refreshButton = (
    <button type="button" className={iconButtonClass} onClick={onRefresh} disabled={isRefreshing} title={t('tooltips.refresh')} aria-label={t('tooltips.refresh')}>
      <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
    </button>
  );

  let heading: ReactNode;
  if (mode === 'archive') {
    heading = (
      <PaneHeading
        title={t('archived.title', 'Archive')}
        subtitle={archivedSessionsCount > 0
          ? `${archivedSessionsCount} archived, restore any time`
          : t('archived.restoreHint', 'Restore items whenever you need them')}
        actions={(
          <button type="button" className={iconButtonClass} onClick={() => onModeChange('sessions')} title={t('tooltips.cancel', 'Close')} aria-label="Close archive">
            <X className="h-4 w-4" />
          </button>
        )}
      />
    );
  } else if (scopeProject) {
    heading = (
      <>
        {isRenamingProject ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={activeRename.draft}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') onSaveProjectName(scopeProject.projectId, activeRename.draft);
                if (event.key === 'Escape') onCancelRename();
              }}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring"
              style={isMobile ? { fontSize: '16px' } : undefined}
              aria-label="Project name"
              autoFocus
            />
            <button type="button" className={iconButtonClass} onClick={() => onSaveProjectName(scopeProject.projectId, activeRename.draft)} title={t('tooltips.save')} aria-label={t('tooltips.save')}>
              <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
            </button>
            <button type="button" className={iconButtonClass} onClick={onCancelRename} title={t('tooltips.cancel')} aria-label={t('tooltips.cancel')}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <PaneHeading
            leading={(
              <button
                type="button"
                onClick={() => setIsIconPickerOpen(true)}
                title="Change icon and colour"
                aria-label={`Change icon and colour for ${scopeProject.displayName}`}
                className="mt-0.5 flex-shrink-0 rounded-[10px] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
              >
                <ProjectMonogram
                  projectId={scopeProject.projectId}
                  name={scopeProject.displayName}
                  appearance={projectAppearance.get(scopeProject.projectId)}
                  size="md"
                />
              </button>
            )}
            title={scopeProject.displayName}
            subtitle={<span title={scopeProject.fullPath}>{scopeProject.fullPath.replace(/^\/(Users|home)\/[^/]+/, '~')}</span>}
            actions={(
              <>
                <button
                  type="button"
                  className={iconButtonClass}
                  onClick={() => onToggleStarProject(scopeProject.projectId)}
                  title={isScopeProjectStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
                  aria-label={isScopeProjectStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
                  aria-pressed={isScopeProjectStarred}
                >
                  <Star className={cn('h-3.5 w-3.5', isScopeProjectStarred && 'fill-amber-400 text-amber-500')} />
                </button>
                <ActionMenu
                  label="Project options"
                  ariaLabel={`Project options for ${scopeProject.displayName}`}
                  icon={MoreHorizontal}
                  iconOnly
                  portal
                  variant="ghost"
                  size="icon"
                  triggerClassName="h-7 w-7 text-muted-foreground hover:bg-accent hover:text-foreground"
                  menuClassName="w-[220px] rounded-xl p-1.5 shadow-xl"
                  items={[
                    {
                      key: 'rename',
                      label: t('tooltips.renameProject', 'Rename project'),
                      icon: Edit3,
                      onSelect: () => onStartEditingProject(scopeProject),
                    },
                    {
                      key: 'icon',
                      label: 'Icon and colour',
                      icon: Smile,
                      onSelect: () => setIsIconPickerOpen(true),
                    },
                    {
                      key: 'copy-path',
                      label: 'Copy path',
                      icon: Copy,
                      onSelect: () => { void navigator.clipboard?.writeText(scopeProject.fullPath); },
                    },
                    {
                      key: 'refresh',
                      label: t('tooltips.refresh'),
                      icon: RefreshCw,
                      disabled: isRefreshing,
                      onSelect: onRefresh,
                    },
                    {
                      key: 'delete',
                      label: t('tooltips.deleteProject', 'Delete project'),
                      icon: Trash2,
                      isDanger: true,
                      disabled: isScopeProjectDeleting,
                      showDividerBefore: true,
                      onSelect: () => onDeleteProject(scopeProject),
                    },
                  ]}
                />
                {collapseButton}
              </>
            )}
          />
        )}
        <button
          type="button"
          onClick={() => onNewSession(scopeProject)}
          className="mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-200 text-xs font-medium text-blue-900 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] dark:bg-blue-500/20 dark:text-blue-100 dark:hover:bg-blue-500/30"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('sessions.newSession')}
        </button>
        {onNewVoiceSession && (
          <button
            type="button"
            title={t('sessions.newVoiceSessionTitle')}
            onClick={() => onNewVoiceSession(scopeProject)}
            className="mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-200 text-xs font-medium text-blue-900 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] dark:bg-blue-500/20 dark:text-blue-100 dark:hover:bg-blue-500/30"
          >
            <Mic className="h-3.5 w-3.5" />
            {t('sessions.newVoiceSession')}
          </button>
        )}
      </>
    );
  } else {
    heading = (
      <PaneHeading
        title={t('navigator.allSessions', 'All sessions')}
        subtitle={describeTotals(totalActivity)}
        actions={(
          <>
            {refreshButton}
            {collapseButton}
          </>
        )}
      />
    );
  }

  const searchPlaceholder = mode === 'archive'
    ? t('search.archivedPlaceholder', 'Search archived sessions...')
    : mode === 'messages'
      ? 'Search messages in every project'
      : isAllScope
        ? 'Filter sessions or projects'
        : 'Filter sessions';

  let body: ReactNode;
  if (mode === 'archive') {
    body = (
      <ArchiveList
        archivedProjects={archivedProjects}
        archivedSessions={archivedSessions}
        archivedSessionsCount={archivedSessionsCount}
        isArchivedSessionsLoading={isArchivedSessionsLoading}
        currentTime={currentTime}
        onRestoreArchivedProject={onRestoreArchivedProject}
        onArchivedSessionClick={onArchivedSessionClick}
        onRestoreArchivedSession={onRestoreArchivedSession}
        onDeleteArchivedSession={onDeleteArchivedSession}
        t={t}
      />
    );
  } else if (mode === 'messages') {
    body = query.length < 2 ? (
      <p className="px-4 py-8 text-center text-xs text-muted-foreground">
        Type at least two characters to search inside every conversation.
      </p>
    ) : (
      <MessageSearchResults
        conversationResults={conversationResults}
        isSearching={isSearching}
        searchProgress={searchProgress}
        currentTime={currentTime}
        onConversationResultClick={onConversationResultClick}
        t={t}
      />
    );
  } else if (isLoading || projectsCount === 0) {
    body = (
      <SidebarProjectsState
        isLoading={isLoading}
        loadingProgress={loadingProgress}
        projectsCount={projectsCount}
        filteredProjectsCount={projectsCount}
        t={t}
      />
    );
  } else if (sessionCount === 0) {
    body = (
      <div className="px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          {query ? `No session titles match "${query}".` : t('sessions.noSessions')}
        </p>
        {query.length >= 2 && (
          <button
            type="button"
            onClick={() => onModeChange('messages')}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Search className="h-3.5 w-3.5" />
            Search inside messages
          </button>
        )}
      </div>
    );
  } else {
    body = (
      <div className="space-y-3 px-1.5 pb-3">
        {groups.map((group) => {
          const isCollapsed = isGroupCollapsed(group.key);
          const headingId = `session-group-${group.key}`;
          return (
            <section key={group.key} aria-labelledby={headingId}>
              <button
                type="button"
                id={headingId}
                onClick={() => toggleGroup(group.key)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronRight className={cn('h-3 w-3 transition-transform duration-150', !isCollapsed && 'rotate-90')} />
                <span className={cn(
                  group.key === 'review' && 'text-green-700 dark:text-green-400',
                  group.key === 'running' && 'text-blue-700 dark:text-blue-400',
                )}
                >
                  {GROUP_LABELS[group.key]}
                </span>
                <span className="ml-auto tabular-nums text-muted-foreground/70">{group.sessions.length}</span>
              </button>
              {!isCollapsed && (
                <div className="mt-0.5 space-y-px">
                  {group.sessions.map(({ session, project, isRunning, isUnread }) => {
                    const isEditing = activeRename?.target === 'session' && activeRename.id === session.id;
                    return (
                      <SessionPaneRow
                        key={session.id}
                        session={session}
                        project={project}
                        isSelected={session.id === selectedSessionId}
                        isRunning={isRunning}
                        isUnread={isUnread}
                        isVoice={voiceSessionIds.has(session.id)}
                        showProject={isAllScope}
                        projectAppearance={projectAppearance.get(project.projectId) ?? null}
                        currentTime={currentTime}
                        isEditing={isEditing}
                        renameDraft={isEditing ? activeRename.draft : ''}
                        onSelect={onSelectSession}
                        onRenameDraftChange={onRenameDraftChange}
                        onStartEditingSession={onStartEditingSession}
                        onCancelEditingSession={onCancelRename}
                        onSaveEditingSession={onSaveEditingSession}
                        onDeleteSession={onDeleteSession}
                        onForkSession={onForkSession}
                        t={t}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
        {scopeProject && hasMoreSessions && !query && (
          <button
            type="button"
            onClick={() => onLoadMoreSessions(scopeProject.projectId)}
            disabled={isLoadingMoreSessions}
            className="w-full rounded-md py-2 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            {isLoadingMoreSessions ? t('sessions.loadingSessions') : 'Load older sessions'}
          </button>
        )}
      </div>
    );
  }

  const showSearchModeToggle = mode !== 'archive' && (query.length > 0 || mode === 'messages');

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-background md:w-[17rem] md:flex-none">
      <div className="flex-shrink-0 px-3 pb-2 pt-3" style={isPWA && isMobile ? { paddingTop: '16px' } : undefined}>
        {heading}
        <div className="relative mt-2.5">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            type="text"
            placeholder={searchPlaceholder}
            value={searchFilter}
            onChange={(event) => onSearchFilterChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && searchFilter) {
                event.stopPropagation();
                onSearchFilterChange('');
              }
            }}
            aria-label={searchPlaceholder}
            className="nav-search-input h-8 rounded-lg border-0 pl-8 pr-8 text-[13px] placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0"
            style={isMobile ? { fontSize: '16px' } : undefined}
          />
          {searchFilter && (
            <button
              type="button"
              onClick={() => onSearchFilterChange('')}
              aria-label={t('tooltips.clearSearch')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-accent"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {showSearchModeToggle && (
          <div className="mt-2 flex gap-1" role="group" aria-label="Search in">
            {(['sessions', 'messages'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onModeChange(option)}
                aria-pressed={mode === option}
                className={cn(
                  'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                  mode === option ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {option === 'sessions' ? (isAllScope ? 'Titles' : 'Titles here') : 'Messages everywhere'}
              </button>
            ))}
          </div>
        )}
      </div>

      <ScrollArea ref={listRef} className="min-h-0 flex-1 overscroll-contain">
        {body}
      </ScrollArea>

      {scopeProject && (
        <ProjectIconPicker
          // Remounted per project so the tab and the typed emoji start fresh.
          key={scopeProject.projectId}
          open={isIconPickerOpen}
          onOpenChange={setIsIconPickerOpen}
          project={scopeProject}
          appearance={projectAppearance.get(scopeProject.projectId) ?? null}
          onChange={(change) => onSetProjectAppearance(scopeProject.projectId, change)}
        />
      )}
    </div>
  );
}

export default memo(SessionPane);
