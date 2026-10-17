import { useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/shared/api';
import { readSelectedProvider } from '@/shared/selectedProvider';
import type { LLMProvider, Project, ProjectSession, SplitPaneTarget } from '@/shared/types';

type SessionDetailsPayload = {
  data?: {
    provider?: string;
    summary?: string;
    createdAt?: string | null;
    lastActivity?: string | null;
    project?: {
      projectId?: string;
      path?: string;
      fullPath?: string;
      displayName?: string;
      isStarred?: boolean;
    } | null;
  };
};

type LookupResult = {
  sessionId: string;
  session: ProjectSession;
  project: Project | null;
};

type SplitPaneSelection = {
  project: Project | null;
  session: ProjectSession | null;
  /** The target names a session that is still being looked up; render a placeholder, not a new chat. */
  isResolving: boolean;
};

const readProvider = (value: unknown): LLMProvider => (
  typeof value === 'string' && value.trim() ? value as LLMProvider : readSelectedProvider()
);

/**
 * Resolves the right pane's target to the project and session objects the chat
 * needs, the way useProjectsState resolves the URL for the left pane: from the
 * loaded sidebar payload first, then one backend lookup for a session on a page
 * the sidebar has not loaded.
 *
 * Returned objects keep their identity while nothing the chat reads has
 * changed, so a session upsert elsewhere in the project does not re-render the
 * right pane's whole chat tree.
 */
export function useSplitPaneSelection(
  projects: Project[],
  target: SplitPaneTarget,
  enabled: boolean,
): SplitPaneSelection {
  // The backend answer for a session the loaded payload does not contain.
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const lookupStartedRef = useRef<string | null>(null);

  const fromProjects = useMemo(() => {
    if (!target.sessionId) {
      return null;
    }
    for (const project of projects) {
      const match = project.sessions?.find((session) => session.id === target.sessionId);
      if (match) {
        return {
          project,
          session: { ...match, __provider: readProvider(match.__provider ?? match.provider), __projectId: project.projectId },
        };
      }
    }
    return null;
  }, [projects, target.sessionId]);

  useEffect(() => {
    const sessionId = target.sessionId;
    if (!enabled || !sessionId || fromProjects || lookupStartedRef.current === sessionId) {
      return;
    }
    lookupStartedRef.current = sessionId;

    void (async () => {
      let details: SessionDetailsPayload['data'] | null = null;
      try {
        const response = await api.sessionDetails(sessionId);
        if (response.ok) {
          details = ((await response.json()) as SessionDetailsPayload).data ?? null;
        }
      } catch (error) {
        console.error(`Error resolving split pane session ${sessionId}:`, error);
      }

      const projectId = details?.project?.projectId ?? target.projectId;
      const project = projectId && details?.project
        ? {
          projectId,
          path: details.project.path ?? details.project.fullPath ?? '',
          fullPath: details.project.fullPath ?? details.project.path ?? '',
          displayName: details.project.displayName ?? '',
          isStarred: Boolean(details.project.isStarred),
          sessions: [],
          sessionMeta: { hasMore: false, total: 0 },
        }
        : null;

      // An unknown id still gets a placeholder, as the left pane does, so the
      // chat keeps reading this session instead of falling back to a new chat.
      setLookup({
        sessionId,
        project,
        session: {
          id: sessionId,
          summary: details?.summary ?? '',
          createdAt: details?.createdAt ?? undefined,
          lastActivity: details?.lastActivity ?? undefined,
          __provider: readProvider(details?.provider),
          __projectId: projectId ?? undefined,
        },
      });
    })();
  }, [enabled, fromProjects, target.projectId, target.sessionId]);

  const resolvedLookup = lookup && lookup.sessionId === target.sessionId ? lookup : null;
  const nextSession = fromProjects?.session ?? resolvedLookup?.session ?? null;
  const nextProject = fromProjects?.project
    ?? projects.find((project) => project.projectId === (resolvedLookup?.session.__projectId ?? target.projectId))
    ?? resolvedLookup?.project
    ?? null;

  // Rebuilt only when a field the chat reads changes.
  const session = useMemo<ProjectSession | null>(
    () => nextSession,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nextSession?.id, nextSession?.__provider, nextSession?.__projectId, nextSession?.summary],
  );
  const project = useMemo<Project | null>(
    () => nextProject,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nextProject?.projectId, nextProject?.path, nextProject?.fullPath, nextProject?.displayName],
  );

  return {
    project,
    session: target.sessionId ? session : null,
    isResolving: Boolean(target.sessionId) && !nextSession,
  };
}
