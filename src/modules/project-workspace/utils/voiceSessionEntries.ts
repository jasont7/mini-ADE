import type { LLMProvider, Project, VoiceSessionEntry } from '@/shared/types';

const UNNAMED_SESSION = 'Untitled session';

/**
 * Flattens the projects the sidebar holds into the session list the live
 * voice reads. Names match what the sidebar shows (summary, then name), so the
 * status pill names the session as he sees it. Only sessions already loaded
 * are listed. Used by the workspace's effects controller.
 */
export function buildVoiceSessionEntries(projects: Project[]): VoiceSessionEntry[] {
  const entries: VoiceSessionEntry[] = [];
  for (const project of projects) {
    for (const session of project.sessions ?? []) {
      const provider = session.__provider ?? session.provider;
      entries.push({
        id: session.id,
        name: session.summary || session.name || UNNAMED_SESSION,
        projectName: project.displayName,
        provider: typeof provider === 'string' && provider ? (provider as LLMProvider) : undefined,
      });
    }
  }
  return entries;
}
