import type { ReactNode } from 'react';
import { Folder, MessageSquare, Search } from 'lucide-react';
import type { TFunction } from 'i18next';

import { LLMProviderLogo } from '@/shared/ui';
import type { ConversationSearchResults, SearchProgress } from '@/shared/types';
import { formatCompactAge } from '@/modules/sidebar/utils/sidebarProjectFormatting';

function HighlightedSnippet({ snippet, highlights }: { snippet: string; highlights: { start: number; end: number }[] }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const h of highlights) {
    if (h.start > cursor) {
      parts.push(snippet.slice(cursor, h.start));
    }
    parts.push(
      <mark key={h.start} className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-800">
        {snippet.slice(h.start, h.end)}
      </mark>
    );
    cursor = h.end;
  }
  if (cursor < snippet.length) {
    parts.push(snippet.slice(cursor));
  }
  return (
    <span className="min-w-0 flex-1 break-words text-xs leading-relaxed text-muted-foreground">
      {parts}
    </span>
  );
}

type MessageSearchResultsProps = {
  conversationResults: ConversationSearchResults | null;
  isSearching: boolean;
  searchProgress: SearchProgress | null;
  currentTime: Date;
  // Clicks pass back the DB projectId, or null when the server could not
  // resolve one. Consumers must handle the null case.
  onConversationResultClick: (projectId: string | null, sessionId: string, provider: string, messageTimestamp?: string | null, messageSnippet?: string | null) => void;
  t: TFunction;
};

/** Rendered by SessionPane in its messages mode: title and message-content hits across every project. */
export default function MessageSearchResults({
  conversationResults,
  isSearching,
  searchProgress,
  currentTime,
  onConversationResultClick,
  t,
}: MessageSearchResultsProps) {
  const hasSearchResults = Boolean(
    conversationResults
    && (conversationResults.titleResults.length > 0 || conversationResults.results.length > 0),
  );

  return (
    isSearching && !conversationResults ? (
      <div className="px-4 py-12 text-center md:py-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
        <p className="text-sm text-muted-foreground">{t('search.searching')}</p>
        {searchProgress && (
          <p className="mt-1 text-xs text-muted-foreground/60">
            {t('search.projectsScanned', { count: searchProgress.scannedProjects })}/{searchProgress.totalProjects}
          </p>
        )}
      </div>
    ) : !isSearching && conversationResults && !hasSearchResults ? (
      <div className="px-4 py-12 text-center md:py-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
          <Search className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">{t('search.noResults')}</h3>
        <p className="text-sm text-muted-foreground">{t('search.tryDifferentQuery')}</p>
      </div>
    ) : conversationResults && (hasSearchResults || isSearching) ? (
      <div className="space-y-4 px-2" aria-live="polite">
        {conversationResults.titleResults.length > 0 && (
          <section className="space-y-1" aria-labelledby="session-title-results-heading">
            <div className="flex items-center justify-between px-1 py-0.5">
              <h3
                id="session-title-results-heading"
                className="text-[11px] font-medium text-muted-foreground"
              >
                {t('search.sessionTitles', 'Session')}
              </h3>
              <span className="text-[10px] tabular-nums text-muted-foreground/70">
                {conversationResults.titleResults.length}
              </span>
            </div>

            {conversationResults.titleResults.map((session) => {
              const age = formatCompactAge(session.lastActivity, currentTime);

              return (
                <button
                  key={`${session.provider}-${session.sessionId}`}
                  type="button"
                  className="group flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/60"
                  onClick={() => onConversationResultClick(
                    session.projectId,
                    session.sessionId,
                    session.provider,
                  )}
                >
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-muted/60">
                    <LLMProviderLogo provider={session.provider} className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-normal leading-4 text-foreground">
                      {session.sessionTitle}
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-3 text-muted-foreground">
                      <span className="truncate">{session.projectDisplayName}</span>
                      {age && (
                        <>
                          <span className="flex-shrink-0 text-muted-foreground/40">·</span>
                          <time className="flex-shrink-0 tabular-nums" dateTime={session.lastActivity ?? undefined}>
                            {age}
                          </time>
                        </>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
        )}

        {(conversationResults.results.length > 0 || isSearching) && (
          <section className="space-y-3" aria-labelledby="conversation-content-results-heading">
            <div className="flex items-center justify-between px-1 py-0.5">
              <h3
                id="conversation-content-results-heading"
                className="text-[11px] font-medium text-muted-foreground"
              >
                {t('search.conversationContents', 'Conversation contents')}
              </h3>
              <span className="text-[10px] tabular-nums text-muted-foreground/70">
                {t('search.matches', { count: conversationResults.totalMatches })}
              </span>
            </div>

            {isSearching && searchProgress && (
              <div className="space-y-1.5 px-1">
                <div className="flex items-center justify-end gap-1.5">
                  <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-primary" />
                  <p className="text-[10px] text-muted-foreground/60">
                    {searchProgress.scannedProjects}/{searchProgress.totalProjects}
                  </p>
                </div>
                <div className="h-0.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/60 transition-all duration-300"
                    style={{
                      width: `${searchProgress.totalProjects > 0
                        ? Math.round((searchProgress.scannedProjects / searchProgress.totalProjects) * 100)
                        : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {conversationResults.results.map((projectResult) => (
              <div key={projectResult.projectName} className="space-y-1">
                <div className="flex items-center gap-1.5 px-1 py-1">
                  <Folder className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                  <span className="truncate text-xs font-normal text-foreground">
                    {projectResult.projectDisplayName}
                  </span>
                </div>
                {projectResult.sessions.map((session) => (
                  <button
                    key={`${projectResult.projectId ?? projectResult.projectName}-${session.sessionId}`}
                    className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/50"
                    onClick={() => onConversationResultClick(
                      // Pass the DB projectId (preferred) so the parent can
                      // cross-reference with the loaded projects list.
                      projectResult.projectId,
                      session.sessionId,
                      session.provider || session.matches[0]?.provider || 'claude',
                      session.matches[0]?.timestamp,
                      session.matches[0]?.snippet
                    )}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <MessageSquare className="h-3 w-3 flex-shrink-0 text-primary" />
                      <span className="truncate text-xs font-normal text-foreground">
                        {session.sessionSummary}
                      </span>
                      {session.provider && session.provider !== 'claude' && (
                        <span className="flex-shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] uppercase text-muted-foreground">
                          {session.provider}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 pl-4">
                      {session.matches.map((match, idx) => (
                        <div key={idx} className="flex items-start gap-1">
                          <span className="mt-0.5 flex-shrink-0 text-[10px] font-normal uppercase text-muted-foreground/60">
                            {match.role === 'user' ? 'U' : 'A'}
                          </span>
                          <HighlightedSnippet
                            snippet={match.snippet}
                            highlights={match.highlights}
                          />
                        </div>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </section>
        )}
      </div>
    ) : null
  );
}
