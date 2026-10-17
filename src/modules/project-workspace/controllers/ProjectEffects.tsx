import { useCallback, useEffect, useMemo } from 'react';

import { useRegisterVoiceDirectory } from '@/modules/chat';
import { usePaletteOpsRegister } from '@/modules/command-palette';
import { writeSelectedProvider } from '@/shared/selectedProvider';
import { useProjectEffectsState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { buildVoiceSessionEntries } from '@/modules/project-workspace/utils/voiceSessionEntries';
import { useBusySessionIdSet, useSessionProtectionActions } from '@/shared/context/SessionProtectionContext';
import type { LLMProvider, ProjectWorkspaceShellProps, SessionEstablishedContext } from '@/shared/types';

/** Headless controller rendered by ProjectWorkspaceShell to register palette operations, hand the live voice the sidebar's sessions, and handle service-worker navigation messages. */
export default function ProjectEffects({
  navigate,
}: Pick<ProjectWorkspaceShellProps, 'navigate'>) {
  const {
    projects,
    registerOptimisticSession,
    openSettings,
    refreshProjectsSilently,
    setActiveTab,
    setSidebarOpen,
  } = useProjectEffectsState();

  usePaletteOpsRegister({
    openSettings,
    refreshProjects: refreshProjectsSilently,
  });

  const busyIds = useBusySessionIdSet();
  const { markSessionProcessing } = useSessionProtectionActions();
  const voiceSessions = useMemo(() => buildVoiceSessionEntries(projects), [projects]);
  // The live voice takes him to its session the same way a tapped notification does.
  const openSession = useCallback((sessionId: string) => {
    setActiveTab('chat');
    setSidebarOpen(false);
    navigate(`/session/${sessionId}`);
  }, [navigate, setActiveTab, setSidebarOpen]);
  const voiceDirectory = useMemo(() => ({
    sessions: voiceSessions,
    busyIds,
    openSession,
    markSessionProcessing: (sessionId: string) => markSessionProcessing(sessionId),
    establishSession: (sessionId: string, context: SessionEstablishedContext) => registerOptimisticSession({ sessionId, ...context }),
  }), [voiceSessions, busyIds, openSession, markSessionProcessing, registerOptimisticSession]);
  useRegisterVoiceDirectory(voiceDirectory);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.type !== 'notification:navigate') {
        return;
      }

      if (typeof message.provider === 'string' && message.provider.trim()) {
        writeSelectedProvider(message.provider as LLMProvider);
      }

      setActiveTab('chat');
      setSidebarOpen(false);
      void refreshProjectsSilently();

      if (typeof message.sessionId === 'string' && message.sessionId) {
        navigate(`/session/${message.sessionId}`);
        return;
      }

      navigate('/');
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [navigate, refreshProjectsSilently, setActiveTab, setSidebarOpen]);

  return null;
}
