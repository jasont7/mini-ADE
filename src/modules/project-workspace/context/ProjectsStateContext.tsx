import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { NavigateFunction } from 'react-router-dom';

import { useProjectsState } from '@/modules/project-workspace/hooks/useProjectsState';
import { useReportViewedSession } from '@/modules/project-workspace/hooks/useReportViewedSession';
import { useSplitPaneSelection } from '@/modules/project-workspace/hooks/useSplitPaneSelection';
import { useSplitViewState } from '@/modules/project-workspace/hooks/useSplitViewState';
import { SplitViewActionsProvider } from '@/shared/context/SplitViewActionsContext';
import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import type { IsSessionProcessing, Project, ProjectSession, ServerEvent, SplitPaneTarget } from '@/shared/types';

type ProjectsState = ReturnType<typeof useProjectsState>;
type SplitViewState = ReturnType<typeof useSplitViewState>;

/** Tailwind's `lg`. Split view only shows at or above this width. */
const SPLIT_VIEW_MIN_WIDTH = 1024;

type ProjectSplitViewState = Pick<
  SplitViewState,
  | 'isSplitAvailable'
  | 'isSplitActive'
  | 'focusedPane'
  | 'dividerRatio'
  | 'secondaryNewSessionTrigger'
  | 'closeSplit'
  | 'focusPane'
  | 'setDividerRatio'
  | 'showInSecondary'
> & {
  /** The right pane's resolved project and session (null session = new chat). */
  secondaryProject: Project | null;
  secondarySession: ProjectSession | null;
  isSecondaryResolving: boolean;
  /** The header's split button: opens the right pane on a new chat, or closes it. */
  toggleSplit: () => void;
};

type ProjectSidebarState = Pick<
  ProjectsState,
  'sidebarOpen' | 'setSidebarOpen' | 'sidebarSharedProps'
>;

type ProjectMainState = Pick<
  ProjectsState,
  | 'selectedProject'
  | 'selectedSession'
  | 'activeTab'
  | 'setActiveTab'
  | 'setSidebarOpen'
  | 'isLoadingProjects'
  | 'openSettings'
  | 'externalMessageUpdate'
  | 'newSessionTrigger'
  | 'registerOptimisticSession'
  | 'handleProjectSelect'
  | 'refreshProjectsSilently'
>;

type ProjectCommandState = Pick<
  ProjectsState,
  'selectedProject' | 'handleNewSession' | 'openSettings' | 'setActiveTab'
>;

type ProjectEffectsState = Pick<
  ProjectsState,
  'projects' | 'registerOptimisticSession' | 'openSettings' | 'refreshProjectsSilently' | 'setActiveTab' | 'setSidebarOpen'
>;

type ProjectActiveSessionState = {
  activeSessionId: string | null;
};

type ProjectsStateProviderProps = {
  children: ReactNode;
  sessionId?: string;
  navigate: NavigateFunction;
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  isMobile: boolean;
  isSessionProcessing: IsSessionProcessing;
};

const ProjectSidebarContext = createContext<ProjectSidebarState | null>(null);
const ProjectMainContext = createContext<ProjectMainState | null>(null);
const ProjectCommandContext = createContext<ProjectCommandState | null>(null);
const ProjectEffectsContext = createContext<ProjectEffectsState | null>(null);
const ProjectActiveSessionContext = createContext<ProjectActiveSessionState | null>(null);
const ProjectSplitViewContext = createContext<ProjectSplitViewState | null>(null);

/** Rendered by ProjectWorkspaceRoute to own the workspace's project and session state and expose it through this module's context hooks. */
export function ProjectsStateProvider({
  children,
  sessionId,
  navigate,
  subscribe,
  isMobile,
  isSessionProcessing,
}: ProjectsStateProviderProps) {
  const state = useProjectsState({
    sessionId,
    navigate,
    subscribe,
    isMobile,
    isSessionProcessing,
  });
  const { isMobile: isBelowSplitWidth } = useDeviceSettings({
    mobileBreakpoint: SPLIT_VIEW_MIN_WIDTH,
    trackPWA: false,
  });

  // The URL wins over the selection: the selection catches up one effect
  // later, and split view must not see the old session in the left pane for
  // that render.
  const primarySessionId = sessionId ?? state.selectedSession?.id ?? null;
  const primaryProjectId = state.selectedProject?.projectId ?? null;
  const primaryTarget = useMemo<SplitPaneTarget>(
    () => ({ sessionId: primarySessionId, projectId: primaryProjectId }),
    [primaryProjectId, primarySessionId],
  );

  const { projects, handleNewSession, handleSessionSelect, handleSessionDelete, setActiveTab } = state;

  const handlePrimaryTakeover = useCallback((target: SplitPaneTarget) => {
    if (target.sessionId) {
      navigate(`/session/${target.sessionId}`);
      return;
    }
    const project = projects.find((candidate) => candidate.projectId === target.projectId);
    if (project) {
      handleNewSession(project);
    } else {
      navigate('/');
    }
  }, [handleNewSession, navigate, projects]);

  const split = useSplitViewState({
    isWide: !isBelowSplitWidth,
    primary: primaryTarget,
    onPrimaryTakeover: handlePrimaryTakeover,
  });
  const secondarySelection = useSplitPaneSelection(projects, split.secondary, split.isSplitActive);

  useReportViewedSession(
    split.focusedPane === 'secondary'
      ? split.secondary.sessionId
      : state.selectedSession?.id ?? sessionId ?? null,
  );

  const { openSession, startNewSession, forgetSession, openSplit, closeSplit, isSplitActive } = split;

  // Sidebar picks, new sessions and deletes go through split view, which sends
  // them to the focused pane. Without a split they reach the left pane as before.
  const routedSessionSelect = useCallback((session: ProjectSession) => {
    openSession(
      { sessionId: session.id, projectId: session.__projectId ?? null },
      () => handleSessionSelect(session),
    );
  }, [handleSessionSelect, openSession]);

  const routedNewSession = useCallback((project: Project) => {
    startNewSession(project.projectId, () => handleNewSession(project));
    setActiveTab('chat');
  }, [handleNewSession, setActiveTab, startNewSession]);

  const routedSessionDelete = useCallback((sessionIdToDelete: string) => {
    forgetSession(sessionIdToDelete);
    handleSessionDelete(sessionIdToDelete);
  }, [forgetSession, handleSessionDelete]);

  const focusedSession = split.focusedPane === 'secondary'
    ? secondarySelection.session
    : state.selectedSession;

  const routedSidebarProps = useMemo(
    () => ({
      ...state.sidebarSharedProps,
      // The sidebar highlights the session the user is working in.
      selectedSession: focusedSession,
      onSessionSelect: routedSessionSelect,
      onNewSession: routedNewSession,
      onSessionDelete: routedSessionDelete,
    }),
    [focusedSession, routedNewSession, routedSessionDelete, routedSessionSelect, state.sidebarSharedProps],
  );

  const toggleSplit = useCallback(() => {
    if (isSplitActive) {
      closeSplit();
    } else {
      openSplit();
    }
  }, [closeSplit, isSplitActive, openSplit]);

  const splitViewActions = useMemo(() => ({
    canOpenInSplitView: split.isSplitAvailable,
    openInSplitView: (target: SplitPaneTarget) => {
      openSplit(target);
      setActiveTab('chat');
    },
  }), [openSplit, setActiveTab, split.isSplitAvailable]);

  const splitViewState = useMemo<ProjectSplitViewState>(
    () => ({
      isSplitAvailable: split.isSplitAvailable,
      isSplitActive: split.isSplitActive,
      focusedPane: split.focusedPane,
      dividerRatio: split.dividerRatio,
      secondaryNewSessionTrigger: split.secondaryNewSessionTrigger,
      closeSplit: split.closeSplit,
      focusPane: split.focusPane,
      setDividerRatio: split.setDividerRatio,
      showInSecondary: split.showInSecondary,
      secondaryProject: secondarySelection.project,
      secondarySession: secondarySelection.session,
      isSecondaryResolving: secondarySelection.isResolving,
      toggleSplit,
    }),
    [
      secondarySelection.isResolving,
      secondarySelection.project,
      secondarySelection.session,
      split.closeSplit,
      split.dividerRatio,
      split.focusPane,
      split.focusedPane,
      split.isSplitActive,
      split.isSplitAvailable,
      split.secondaryNewSessionTrigger,
      split.setDividerRatio,
      split.showInSecondary,
      toggleSplit,
    ],
  );

  const sidebarState = useMemo<ProjectSidebarState>(
    () => ({
      sidebarOpen: state.sidebarOpen,
      setSidebarOpen: state.setSidebarOpen,
      sidebarSharedProps: routedSidebarProps,
    }),
    [state.sidebarOpen, state.setSidebarOpen, routedSidebarProps],
  );

  const mainState = useMemo<ProjectMainState>(
    () => ({
      selectedProject: state.selectedProject,
      selectedSession: state.selectedSession,
      activeTab: state.activeTab,
      setActiveTab: state.setActiveTab,
      setSidebarOpen: state.setSidebarOpen,
      isLoadingProjects: state.isLoadingProjects,
      openSettings: state.openSettings,
      externalMessageUpdate: state.externalMessageUpdate,
      newSessionTrigger: state.newSessionTrigger,
      registerOptimisticSession: state.registerOptimisticSession,
      handleProjectSelect: state.handleProjectSelect,
      refreshProjectsSilently: state.refreshProjectsSilently,
    }),
    [
      state.activeTab,
      state.externalMessageUpdate,
      state.handleProjectSelect,
      state.isLoadingProjects,
      state.newSessionTrigger,
      state.openSettings,
      state.refreshProjectsSilently,
      state.registerOptimisticSession,
      state.selectedProject,
      state.selectedSession,
      state.setActiveTab,
      state.setSidebarOpen,
    ],
  );

  const commandState = useMemo<ProjectCommandState>(
    () => ({
      selectedProject: state.selectedProject,
      handleNewSession: state.handleNewSession,
      openSettings: state.openSettings,
      setActiveTab: state.setActiveTab,
    }),
    [state.handleNewSession, state.openSettings, state.selectedProject, state.setActiveTab],
  );

  const effectsState = useMemo<ProjectEffectsState>(
    () => ({
      projects: state.projects,
      registerOptimisticSession: state.registerOptimisticSession,
      openSettings: state.openSettings,
      refreshProjectsSilently: state.refreshProjectsSilently,
      setActiveTab: state.setActiveTab,
      setSidebarOpen: state.setSidebarOpen,
    }),
    [
      state.projects,
      state.registerOptimisticSession,
      state.openSettings,
      state.refreshProjectsSilently,
      state.setActiveTab,
      state.setSidebarOpen,
    ],
  );

  const activeSessionState = useMemo<ProjectActiveSessionState>(
    () => ({ activeSessionId: state.selectedSession?.id ?? sessionId ?? null }),
    [sessionId, state.selectedSession?.id],
  );

  return (
    <ProjectEffectsContext.Provider value={effectsState}>
      <ProjectCommandContext.Provider value={commandState}>
        <ProjectMainContext.Provider value={mainState}>
          <ProjectSidebarContext.Provider value={sidebarState}>
            <ProjectActiveSessionContext.Provider value={activeSessionState}>
              <ProjectSplitViewContext.Provider value={splitViewState}>
                <SplitViewActionsProvider value={splitViewActions}>
                  {children}
                </SplitViewActionsProvider>
              </ProjectSplitViewContext.Provider>
            </ProjectActiveSessionContext.Provider>
          </ProjectSidebarContext.Provider>
        </ProjectMainContext.Provider>
      </ProjectCommandContext.Provider>
    </ProjectEffectsContext.Provider>
  );
}

function useRequiredProjectContext<T>(value: T | null, hookName: string): T {
  if (!value) {
    throw new Error(`${hookName} must be used within ProjectsStateProvider`);
  }
  return value;
}

export function useProjectSidebarState(): ProjectSidebarState {
  return useRequiredProjectContext(useContext(ProjectSidebarContext), 'useProjectSidebarState');
}

export function useProjectMainState(): ProjectMainState {
  return useRequiredProjectContext(useContext(ProjectMainContext), 'useProjectMainState');
}

export function useProjectCommandState(): ProjectCommandState {
  return useRequiredProjectContext(useContext(ProjectCommandContext), 'useProjectCommandState');
}

export function useProjectEffectsState(): ProjectEffectsState {
  return useRequiredProjectContext(useContext(ProjectEffectsContext), 'useProjectEffectsState');
}

export function useProjectActiveSessionState(): ProjectActiveSessionState {
  return useRequiredProjectContext(
    useContext(ProjectActiveSessionContext),
    'useProjectActiveSessionState',
  );
}

export function useProjectSplitViewState(): ProjectSplitViewState {
  return useRequiredProjectContext(useContext(ProjectSplitViewContext), 'useProjectSplitViewState');
}
