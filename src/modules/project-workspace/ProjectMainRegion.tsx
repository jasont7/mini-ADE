import { memo, useCallback } from 'react';

import { useProjectMainState, useProjectSplitViewState } from '@/modules/project-workspace/context/ProjectsStateContext';
import type { SessionEstablishedContext, SessionNavigationOptions,ProjectWorkspaceShellProps } from '@/shared/types';
import WorkspaceMain from '@/modules/project-workspace/WorkspaceMain';

/** Rendered by ProjectWorkspaceShell to bind this module's project state to WorkspaceMain. */
function ProjectMainRegion({
  isMobile,
  ws,
  sendMessage,
  navigate,
}: ProjectWorkspaceShellProps) {
  const {
    selectedProject,
    selectedSession,
    activeTab,
    setActiveTab,
    setSidebarOpen,
    isLoadingProjects,
    openSettings,
    externalMessageUpdate,
    newSessionTrigger,
    registerOptimisticSession,
    handleProjectSelect,
    refreshProjectsSilently,
  } = useProjectMainState();
  const splitView = useProjectSplitViewState();

  const handleOpenSidebar = useCallback(() => {
    setSidebarOpen(true);
  }, [setSidebarOpen]);

  const handleNavigateToSession = useCallback((
    targetSessionId: string,
    options?: SessionNavigationOptions,
  ) => {
    navigate(`/session/${targetSessionId}`, { replace: Boolean(options?.replace) });
  }, [navigate]);

  const handleSessionEstablished = useCallback((
    targetSessionId: string,
    context: SessionEstablishedContext,
  ) => {
    registerOptimisticSession({ sessionId: targetSessionId, ...context });
  }, [registerOptimisticSession]);

  // The right pane's new chat still needs its sidebar row, but must not take
  // over the left pane's selection.
  const handleSecondarySessionEstablished = useCallback((
    targetSessionId: string,
    context: SessionEstablishedContext,
  ) => {
    registerOptimisticSession({ sessionId: targetSessionId, ...context, select: false });
  }, [registerOptimisticSession]);

  const handleProjectsRefresh = useCallback(() => {
    void refreshProjectsSilently();
  }, [refreshProjectsSilently]);

  return (
    <WorkspaceMain
      selectedProject={selectedProject}
      selectedSession={selectedSession}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      ws={ws}
      sendMessage={sendMessage}
      isMobile={isMobile}
      onMenuClick={handleOpenSidebar}
      isLoading={isLoadingProjects}
      onNavigateToSession={handleNavigateToSession}
      onSessionEstablished={handleSessionEstablished}
      onSecondarySessionEstablished={handleSecondarySessionEstablished}
      splitView={splitView}
      onShowSettings={openSettings}
      externalMessageUpdate={externalMessageUpdate}
      newSessionTrigger={newSessionTrigger}
      onProjectSelect={handleProjectSelect}
      onProjectsRefresh={handleProjectsRefresh}
    />
  );
}

export default memo(ProjectMainRegion);
