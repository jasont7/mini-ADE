import type {
  Project,
  ProjectActivitySummary,
  SessionTriageGroup,
  SessionTriageGroupKey,
  SessionViewState,
  TriagedSession,
} from '@/shared/types';
import {
  getAllSessions,
  isSessionUnread,
  resolveSessionViewState,
} from '@/modules/sidebar/utils/sidebarProjectFormatting';

const DAY_MS = 24 * 60 * 60 * 1000;

const GROUP_ORDER: SessionTriageGroupKey[] = ['review', 'running', 'today', 'week', 'older'];

type SessionActivityInputs = {
  activeSessions: ReadonlySet<string>;
  sessionViewStates: ReadonlyMap<string, SessionViewState>;
  /** The open session never counts as unread: it is being read. */
  selectedSessionId: string | null;
};

type TriageInputs = SessionActivityInputs & {
  projects: Project[];
  /** Restrict to one project, or null for every project. */
  scopeProjectId: string | null;
  query: string;
  /** The current time as epoch ms; buckets are relative to its local midnight. */
  nowMs: number;
};

const toMs = (timestamp: unknown): number => {
  const ms = typeof timestamp === 'string' && timestamp ? Date.parse(timestamp) : Number.NaN;
  return Number.isNaN(ms) ? 0 : ms;
};

const sessionTitle = (session: { summary?: unknown; name?: unknown }): string => {
  if (typeof session.summary === 'string' && session.summary) return session.summary;
  if (typeof session.name === 'string' && session.name) return session.name;
  return '';
};

const isUnreadSession = (
  session: TriagedSession['session'],
  { activeSessions, sessionViewStates, selectedSessionId }: SessionActivityInputs,
): boolean => {
  if (session.id === selectedSessionId || activeSessions.has(session.id)) {
    return false;
  }
  return isSessionUnread(resolveSessionViewState(session, sessionViewStates.get(session.id)));
};

/**
 * Files every session in scope under the heading the session pane shows it
 * under, so what needs attention sits at the top regardless of project.
 *
 * A running session is never also "to review": its reply is still coming. The
 * recency buckets are calendar based (since local midnight, the six days
 * before that) rather than rolling, which is how people say "today".
 */
export function triageSessions({
  projects,
  scopeProjectId,
  query,
  nowMs,
  ...activity
}: TriageInputs): SessionTriageGroup[] {
  const normalizedQuery = query.trim().toLowerCase();
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = startOfToday.getTime() - 6 * DAY_MS;

  const buckets = new Map<SessionTriageGroupKey, TriagedSession[]>(
    GROUP_ORDER.map((key) => [key, []]),
  );

  for (const project of projects) {
    if (scopeProjectId !== null && project.projectId !== scopeProjectId) {
      continue;
    }

    // In the all-projects view a query also matches the project name, so typing
    // a project's name lists its sessions.
    const projectMatches = Boolean(normalizedQuery)
      && scopeProjectId === null
      && (project.displayName || '').toLowerCase().includes(normalizedQuery);

    for (const session of getAllSessions(project)) {
      if (normalizedQuery && !projectMatches
        && !sessionTitle(session).toLowerCase().includes(normalizedQuery)) {
        continue;
      }

      const isRunning = activity.activeSessions.has(session.id);
      const isUnread = isUnreadSession(session, activity);
      const lastActivityMs = toMs(session.lastActivity) || toMs(session.createdAt) || toMs(session.created_at);

      const key: SessionTriageGroupKey = isRunning
        ? 'running'
        : isUnread
          ? 'review'
          : lastActivityMs >= startOfToday.getTime()
            ? 'today'
            : lastActivityMs >= startOfWeek
              ? 'week'
              : 'older';

      buckets.get(key)!.push({ session, project, isRunning, isUnread, lastActivityMs });
    }
  }

  return GROUP_ORDER
    .map((key) => ({
      key,
      sessions: buckets.get(key)!.sort((a, b) => b.lastActivityMs - a.lastActivityMs),
    }))
    .filter((group) => group.sessions.length > 0);
}

/** Running and unread counts per project id, for the rail's tiles. */
export function summarizeProjectActivity(
  projects: Project[],
  activity: SessionActivityInputs,
): Map<string, ProjectActivitySummary> {
  const summaries = new Map<string, ProjectActivitySummary>();
  for (const project of projects) {
    let running = 0;
    let unread = 0;
    for (const session of getAllSessions(project)) {
      if (activity.activeSessions.has(session.id)) {
        running += 1;
      } else if (isUnreadSession(session, activity)) {
        unread += 1;
      }
    }
    summaries.set(project.projectId, { running, unread });
  }
  return summaries;
}
