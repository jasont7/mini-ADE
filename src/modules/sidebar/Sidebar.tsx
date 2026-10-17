import { memo, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import { useVersionCheck } from '@/shared/hooks/useVersionCheck';
import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import { getPageTitle } from '@/shared/utils';
import { useSidebarController } from '@/modules/sidebar/hooks/useSidebarController';
import { useNavigatorShortcuts } from '@/modules/sidebar/hooks/useNavigatorShortcuts';
import { useProjectAppearance } from '@/modules/sidebar/hooks/useProjectAppearance';
import { useProjectOrder } from '@/modules/sidebar/hooks/useProjectOrder';
import { arrangeRailSections, reorderRailSections } from '@/modules/sidebar/utils/projectOrder';
import { summarizeProjectActivity, triageSessions } from '@/modules/sidebar/utils/sessionTriage';
import { useTaskMaster } from '@/modules/task-master';
import { useLiveVoiceController } from '@/modules/chat';
import { usePaletteOps } from '@/modules/command-palette';
import { useBusySessionIdSet } from '@/shared/context/SessionProtectionContext';
import type { ArchivedSessionListItem, LLMProvider, LoadingProgress, MCPServerStatus, Project, ProjectActivitySummary, ProjectSession, SessionViewState, SessionWithProvider } from '@/shared/types';
import ProjectRail from '@/modules/sidebar/ProjectRail';
import SessionPane from '@/modules/sidebar/SessionPane';
import SidebarModals from '@/modules/sidebar/SidebarModals';

type SidebarProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  sessionViewStates: ReadonlyMap<string, SessionViewState>;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onNewSession: (project: Project) => void;
  onSessionDelete?: (sessionId: string) => void;
  onLoadMoreSessions?: (projectId: string) => Promise<void> | void;
  // `projectId` is the DB identifier; the sidebar hands it back to the parent
  // when the delete flow completes.
  onProjectDelete?: (projectId: string) => void;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  onRefresh: () => Promise<void> | void;
  onShowSettings: () => void;
  showSettings: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
  isMobile: boolean;
};

type TaskMasterSidebarContext = {
  setCurrentProject: (project: Project) => void;
  mcpServerStatus: MCPServerStatus;
};

/**
 * Exported through the sidebar barrel; the project-workspace module renders it
 * as the app's navigation: a rail of project tiles that shows activity in every
 * project at once, and a session pane that lists one project's sessions (or
 * every project's) grouped by what needs attention.
 */
function Sidebar({
  projects,
  selectedProject,
  selectedSession,
  sessionViewStates,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onSessionDelete,
  onLoadMoreSessions,
  onProjectDelete,
  isLoading,
  loadingProgress,
  onRefresh,
  onShowSettings,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  isMobile,
}: SidebarProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { updateAvailable, restartRequired, latestVersion, currentVersion, releaseInfo, installMode } = useVersionCheck(
    'siteboon',
    'claudecodeui',
  );
  const preferences = useUiPreferences();
  const setPreference = useSetUiPreference();
  const { sidebarVisible, railTwoColumns } = preferences;
  const { setCurrentProject } = useTaskMaster() as TaskMasterSidebarContext;
  const paletteOps = usePaletteOps();
  const liveVoice = useLiveVoiceController();
  // Only membership is rendered here, so subscribing to the full activity map
  // would re-render the whole tree on every provider status frame.
  const activeSessions = useBusySessionIdSet();
  const { appearance: projectAppearance, setProjectAppearance } = useProjectAppearance();
  const { order: projectOrder, setProjectOrder } = useProjectOrder();

  const {
    isSidebarCollapsed,
    scopeProjectId,
    setScopeProjectId,
    activeRename,
    showNewProject,
    currentTime,
    isRefreshing,
    searchFilter,
    searchMode,
    setSearchMode,
    conversationResults,
    isSearching,
    searchProgress,
    clearConversationResults,
    deletingProjects,
    pendingDeletion,
    showVersionModal,
    sortedProjects,
    archivedProjects,
    archivedSessions,
    archivedSessionsCount,
    isArchivedSessionsLoading,
    handleSessionClick,
    toggleStarProject,
    isProjectStarred,
    getProjectSessions,
    loadingMoreProjects,
    loadMoreSessionsForProject,
    startEditingProject,
    startEditingSession,
    updateRenameDraft,
    cancelRename,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    requestProjectDelete,
    confirmDeleteProject,
    handleProjectSelect,
    openArchivedSession,
    restoreArchivedProject,
    restoreArchivedSession,
    refreshProjects,
    updateSessionSummary,
    forkSession,
    collapseSidebar,
    expandSidebar,
    setShowNewProject,
    setSearchFilter,
    setPendingDeletion,
    setShowVersionModal,
  } = useSidebarController({
    projects,
    selectedProject,
    isMobile,
    t,
    onRefresh,
    onProjectSelect,
    onSessionSelect,
    onSessionDelete,
    onLoadMoreSessions,
    onProjectDelete,
    setCurrentProject,
    setSidebarVisible: (visible) => setPreference('sidebarVisible', visible),
    sidebarVisible,
  });

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.classList.toggle('pwa-mode', isPWA);
    document.body.classList.toggle('pwa-mode', isPWA);
  }, [isPWA]);

  const pageTitle = getPageTitle(selectedProject, selectedSession);
  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);

  const railSections = useMemo(
    () => arrangeRailSections(sortedProjects, projectOrder),
    [projectOrder, sortedProjects],
  );
  // The rail's display order, which Alt+1..9 follow.
  const railProjects = useMemo(
    () => [...railSections.starred, ...railSections.regular],
    [railSections],
  );

  const handleReorderProjects = useCallback((activeId: string, overId: string) => {
    const next = reorderRailSections(railSections, activeId, overId);
    if (next) {
      setProjectOrder(next);
    }
  }, [railSections, setProjectOrder]);

  const handleToggleTwoColumns = useCallback(() => {
    setPreference('railTwoColumns', !railTwoColumns);
  }, [railTwoColumns, setPreference]);

  const selectedSessionId = selectedSession?.id ?? null;
  // A stored scope can outlive its project (deleted, archived); show everything then.
  const scopeProject = scopeProjectId
    ? sortedProjects.find((project) => project.projectId === scopeProjectId) ?? null
    : null;
  const effectiveScopeId = scopeProject?.projectId ?? null;
  const openProjectId = (selectedSession?.__projectId as string | undefined) ?? selectedProject?.projectId ?? null;

  const activityByProject = useMemo(
    () => summarizeProjectActivity(sortedProjects, { activeSessions, sessionViewStates, selectedSessionId }),
    [activeSessions, selectedSessionId, sessionViewStates, sortedProjects],
  );

  const totalActivity = useMemo<ProjectActivitySummary>(() => {
    let running = 0;
    let unread = 0;
    for (const summary of activityByProject.values()) {
      running += summary.running;
      unread += summary.unread;
    }
    return { running, unread };
  }, [activityByProject]);

  const nowMs = currentTime.getTime();
  const groups = useMemo(
    () => triageSessions({
      projects: sortedProjects,
      scopeProjectId: effectiveScopeId,
      query: searchMode === 'sessions' ? searchFilter : '',
      nowMs,
      activeSessions,
      sessionViewStates,
      selectedSessionId,
    }),
    [activeSessions, effectiveScopeId, nowMs, searchFilter, searchMode, selectedSessionId, sessionViewStates, sortedProjects],
  );

  // On touch layouts a session tap also selects its project, which is what
  // closes the drawer; desktop resolves the project from the session route.
  const handleSelectSession = useCallback((session: SessionWithProvider, project: Project) => {
    if (isMobile) {
      handleProjectSelect(project);
    }
    handleSessionClick(session, project.projectId);
  }, [handleProjectSelect, handleSessionClick, isMobile]);

  useNavigatorShortcuts({
    onSelectScopeIndex: (index) => {
      if (index === 0) {
        setScopeProjectId(null);
        return;
      }
      const project = railProjects[index - 1];
      if (project) {
        setScopeProjectId(project.projectId);
      }
    },
    onStepSession: (direction) => {
      if (searchMode !== 'sessions') return;
      const ordered = groups.flatMap((group) => group.sessions);
      if (ordered.length === 0) return;
      const currentIndex = ordered.findIndex((entry) => entry.session.id === selectedSessionId);
      const nextIndex = currentIndex === -1
        ? (direction === 1 ? 0 : ordered.length - 1)
        : Math.min(ordered.length - 1, Math.max(0, currentIndex + direction));
      if (nextIndex === currentIndex) return;
      const next = ordered[nextIndex];
      handleSessionClick(next.session, next.project.projectId);
    },
  });

  const handleModeChange = useCallback((mode: typeof searchMode) => {
    setSearchMode(mode);
    if (mode !== 'messages') clearConversationResults();
  }, [clearConversationResults, setSearchMode]);

  const handleToggleArchive = useCallback(() => {
    handleModeChange(searchMode === 'archive' ? 'sessions' : 'archive');
    expandSidebar();
  }, [expandSidebar, handleModeChange, searchMode]);

  const handleProjectCreated = () => {
    void paletteOps.refreshProjects();
  };

  // Stable so memo() on the rows can bail out; an inline arrow here would give
  // every row a new callback on each render.
  const handleSaveProjectName = useCallback((projectId: string, nextName: string) => {
    void saveProjectName(projectId, nextName);
  }, [saveProjectName]);

  const handleSaveSessionName = useCallback(
    (projectId: string, sessionId: string, summary: string, provider: LLMProvider) => {
      void updateSessionSummary(projectId, sessionId, summary, provider);
    },
    [updateSessionSummary],
  );

  const handleForkSession = useCallback((session: SessionWithProvider) => {
    void forkSession(session);
  }, [forkSession]);

  const handleConversationResultClick = useCallback((
    projectId: string | null,
    sessionId: string,
    provider: string,
    messageTimestamp?: string | null,
    messageSnippet?: string | null,
  ) => {
    // The server emits a null projectId when it can't resolve a project row
    // for the hit; still navigate to the session so it opens from the URL.
    const resolvedProvider = (provider || 'claude') as LLMProvider;
    const project = projectId ? projects.find((candidate) => candidate.projectId === projectId) : null;
    const searchTarget = { __searchTargetTimestamp: messageTimestamp || null, __searchTargetSnippet: messageSnippet || null };
    const sessionObj = {
      id: sessionId,
      __provider: resolvedProvider,
      __projectId: projectId ?? undefined,
      ...searchTarget,
    };
    if (project) {
      handleProjectSelect(project);
      const existing = getProjectSessions(project).find((session) => session.id === sessionId);
      handleSessionClick(existing ? { ...existing, ...searchTarget } : sessionObj, project.projectId);
    } else {
      handleSessionClick(sessionObj, projectId ?? '');
    }
  }, [getProjectSessions, handleProjectSelect, handleSessionClick, projects]);

  const handleDeleteArchivedSession = useCallback((session: ArchivedSessionListItem) => {
    showDeleteSessionConfirmation(session.sessionId, session.sessionTitle, { isArchived: true });
  }, [showDeleteSessionConfirmation]);

  return (
    <>
      <SidebarModals
        projects={projects}
        showSettings={showSettings}
        settingsInitialTab={settingsInitialTab}
        onCloseSettings={onCloseSettings}
        showNewProject={showNewProject}
        onCloseNewProject={() => setShowNewProject(false)}
        onProjectCreated={handleProjectCreated}
        pendingDeletion={pendingDeletion}
        onCancelDeletion={() => setPendingDeletion(null)}
        onConfirmDeleteProject={confirmDeleteProject}
        onConfirmDeleteSession={confirmDeleteSession}
        showVersionModal={showVersionModal}
        onCloseVersionModal={() => setShowVersionModal(false)}
        releaseInfo={releaseInfo}
        currentVersion={currentVersion}
        latestVersion={latestVersion}
        installMode={installMode}
        t={t}
      />

      <div className="flex h-full w-full md:select-none" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
        <ProjectRail
          sections={railSections}
          isTwoColumns={railTwoColumns}
          onToggleTwoColumns={handleToggleTwoColumns}
          onReorder={handleReorderProjects}
          activityByProject={activityByProject}
          projectAppearance={projectAppearance}
          totalActivity={totalActivity}
          scopeProjectId={effectiveScopeId}
          openProjectId={openProjectId}
          isArchiveOpen={searchMode === 'archive'}
          isPaneCollapsed={isSidebarCollapsed}
          updateAvailable={updateAvailable}
          restartRequired={restartRequired}
          onSelectScope={setScopeProjectId}
          onToggleArchive={handleToggleArchive}
          onCreateProject={() => setShowNewProject(true)}
          onExpandPane={expandSidebar}
          onShowSettings={onShowSettings}
          onShowVersionModal={() => setShowVersionModal(true)}
          t={t}
        />

        {!isSidebarCollapsed && (
          <SessionPane
            mode={searchMode}
            onModeChange={handleModeChange}
            scopeProject={scopeProject}
            groups={groups}
            totalActivity={totalActivity}
            selectedSessionId={selectedSessionId}
            activeRename={activeRename}
            currentTime={currentTime}
            isMobile={isMobile}
            isPWA={isPWA}
            isLoading={isLoading}
            loadingProgress={loadingProgress}
            projectsCount={projects.length}
            searchFilter={searchFilter}
            onSearchFilterChange={setSearchFilter}
            isRefreshing={isRefreshing}
            onRefresh={() => { void refreshProjects(); }}
            onCollapse={collapseSidebar}
            projectAppearance={projectAppearance}
            onSetProjectAppearance={setProjectAppearance}
            isScopeProjectStarred={scopeProject ? isProjectStarred(scopeProject.projectId) : false}
            isScopeProjectDeleting={scopeProject ? deletingProjects.has(scopeProject.projectId) : false}
            hasMoreSessions={Boolean(scopeProject?.sessionMeta?.hasMore)}
            isLoadingMoreSessions={scopeProject ? loadingMoreProjects.has(scopeProject.projectId) : false}
            onLoadMoreSessions={loadMoreSessionsForProject}
            onNewSession={onNewSession}
            onNewVoiceSession={liveVoice.geminiAvailable ? liveVoice.startVoiceSession : undefined}
            voiceSessionIds={liveVoice.voiceSessionIds}
            onToggleStarProject={toggleStarProject}
            onStartEditingProject={startEditingProject}
            onSaveProjectName={handleSaveProjectName}
            onDeleteProject={requestProjectDelete}
            onSelectSession={handleSelectSession}
            onRenameDraftChange={updateRenameDraft}
            onCancelRename={cancelRename}
            onStartEditingSession={startEditingSession}
            onSaveEditingSession={handleSaveSessionName}
            onDeleteSession={showDeleteSessionConfirmation}
            onForkSession={handleForkSession}
            conversationResults={conversationResults}
            isSearching={isSearching}
            searchProgress={searchProgress}
            onConversationResultClick={handleConversationResultClick}
            archivedProjects={archivedProjects}
            archivedSessions={archivedSessions}
            archivedSessionsCount={archivedSessionsCount}
            isArchivedSessionsLoading={isArchivedSessionsLoading}
            onRestoreArchivedProject={restoreArchivedProject}
            onArchivedSessionClick={openArchivedSession}
            onRestoreArchivedSession={restoreArchivedSession}
            onDeleteArchivedSession={handleDeleteArchivedSession}
            t={t}
          />
        )}
      </div>
    </>
  );
}

export default memo(Sidebar);
