import { useCallback, useEffect, useRef, useState } from 'react';

import type { SplitPaneId, SplitPaneTarget } from '@/shared/types';

type UseSplitViewStateArgs = {
  /** At or above the split-view breakpoint. Below it split view is never shown. */
  isWide: boolean;
  /** What the left pane shows now. It follows the URL, so it is not stored here. */
  primary: SplitPaneTarget;
  /**
   * Shows `target` in the left pane. Called when the window narrows while the
   * right pane is focused, so the pane the user was in is the one that stays.
   */
  onPrimaryTakeover: (target: SplitPaneTarget) => void;
};

type PersistedSplitView = {
  isOpen: boolean;
  secondary: SplitPaneTarget;
  focusedPane: SplitPaneId;
  dividerRatio: number;
};

/** localStorage key. Per device, like `activeTab`: a phone never shows split view. */
const SPLIT_VIEW_STORAGE_KEY = 'split-view';
const DEFAULT_DIVIDER_RATIO = 0.5;
const MIN_DIVIDER_RATIO = 0.25;
const MAX_DIVIDER_RATIO = 0.75;

const EMPTY_TARGET: SplitPaneTarget = { sessionId: null, projectId: null };

const clampDividerRatio = (ratio: number): number => (
  Number.isFinite(ratio)
    ? Math.min(MAX_DIVIDER_RATIO, Math.max(MIN_DIVIDER_RATIO, ratio))
    : DEFAULT_DIVIDER_RATIO
);

const readOptionalString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value : null
);

const readPersistedSplitView = (): PersistedSplitView => {
  const fallback: PersistedSplitView = {
    isOpen: false,
    secondary: EMPTY_TARGET,
    focusedPane: 'primary',
    dividerRatio: DEFAULT_DIVIDER_RATIO,
  };

  try {
    const raw = localStorage.getItem(SPLIT_VIEW_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const secondary = (parsed.secondary ?? {}) as Record<string, unknown>;
    return {
      isOpen: parsed.isOpen === true,
      secondary: {
        sessionId: readOptionalString(secondary.sessionId),
        projectId: readOptionalString(secondary.projectId),
      },
      focusedPane: parsed.focusedPane === 'secondary' ? 'secondary' : 'primary',
      dividerRatio: clampDividerRatio(Number(parsed.dividerRatio ?? DEFAULT_DIVIDER_RATIO)),
    };
  } catch {
    return fallback;
  }
};

/**
 * Split view: a second chat pane beside the URL-bound one, on wide screens.
 *
 * Owns which session the right pane shows, which pane is focused and where the
 * divider sits, and remembers all of it across reloads. Sidebar picks and "new
 * session" go to the focused pane through `openSession` and `startNewSession`;
 * the left-pane path is passed in by the caller because only it knows how to
 * navigate the workspace.
 */
export function useSplitViewState({ isWide, primary, onPrimaryTakeover }: UseSplitViewStateArgs) {
  // Read once: the whole persisted record seeds the state below.
  const [initial] = useState(readPersistedSplitView);
  // Whether the user has split view turned on. Kept while the window is narrow
  // so widening it again brings the split back.
  const [isOpen, setIsOpen] = useState(initial.isOpen);
  // The right pane's session, or a new chat in a project when sessionId is null.
  const [secondary, setSecondary] = useState<SplitPaneTarget>(initial.secondary);
  // The pane that sidebar picks and window-wide keys go to.
  const [storedFocusedPane, setStoredFocusedPane] = useState<SplitPaneId>(initial.focusedPane);
  // Left pane's share of the width, committed when a divider drag ends.
  const [dividerRatio, setDividerRatioState] = useState(initial.dividerRatio);
  // Bumped to reset the right pane to a fresh chat even when it already shows
  // one, the same job `newSessionTrigger` does for the left pane.
  const [secondaryNewSessionTrigger, setSecondaryNewSessionTrigger] = useState(0);

  const isSplitActive = isOpen && isWide;
  const focusedPane: SplitPaneId = isSplitActive ? storedFocusedPane : 'primary';

  useEffect(() => {
    try {
      const record: PersistedSplitView = {
        isOpen,
        secondary,
        focusedPane: storedFocusedPane,
        dividerRatio,
      };
      localStorage.setItem(SPLIT_VIEW_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Storage unavailable: split view still works for this page load.
    }
  }, [dividerRatio, isOpen, secondary, storedFocusedPane]);

  // Read by the narrowing effect, which must only fire on a width change.
  const latestRef = useRef({ isOpen, secondary, storedFocusedPane, primary, onPrimaryTakeover });
  latestRef.current = { isOpen, secondary, storedFocusedPane, primary, onPrimaryTakeover };
  const wasWideRef = useRef(isWide);

  useEffect(() => {
    const wasWide = wasWideRef.current;
    wasWideRef.current = isWide;
    if (!wasWide || isWide) {
      return;
    }

    const latest = latestRef.current;
    if (!latest.isOpen || latest.storedFocusedPane !== 'secondary') {
      return;
    }

    // Keep the pane the user was working in. The left pane's session moves to
    // the hidden right pane rather than being dropped.
    setSecondary(latest.primary);
    setStoredFocusedPane('primary');
    latest.onPrimaryTakeover(latest.secondary);
  }, [isWide]);

  /** Opens the right pane on `target`, a new chat in the left pane's project by default. */
  const openSplit = useCallback((target?: SplitPaneTarget) => {
    const nextTarget = target ?? { sessionId: null, projectId: primary.projectId };
    if (nextTarget.sessionId && nextTarget.sessionId === primary.sessionId) {
      // Never run one conversation in two panes.
      setStoredFocusedPane('primary');
      return;
    }
    setSecondary(nextTarget);
    if (!nextTarget.sessionId) {
      setSecondaryNewSessionTrigger((previous) => previous + 1);
    }
    setIsOpen(true);
    setStoredFocusedPane('secondary');
  }, [primary.projectId, primary.sessionId]);

  const closeSplit = useCallback(() => {
    setIsOpen(false);
    setStoredFocusedPane('primary');
  }, []);

  const focusPane = useCallback((pane: SplitPaneId) => {
    setStoredFocusedPane(pane);
  }, []);

  const setDividerRatio = useCallback((ratio: number) => {
    setDividerRatioState(clampDividerRatio(ratio));
  }, []);

  /**
   * Opens a session picked in the sidebar in the focused pane. A session that
   * is already open in either pane is focused there instead of opened twice.
   */
  const openSession = useCallback((target: SplitPaneTarget, openInPrimary: () => void) => {
    if (!isSplitActive) {
      openInPrimary();
      return;
    }
    if (target.sessionId && target.sessionId === primary.sessionId) {
      setStoredFocusedPane('primary');
      return;
    }
    if (target.sessionId && target.sessionId === secondary.sessionId) {
      setStoredFocusedPane('secondary');
      return;
    }
    if (storedFocusedPane === 'secondary') {
      setSecondary(target);
      return;
    }
    openInPrimary();
  }, [isSplitActive, primary.sessionId, secondary.sessionId, storedFocusedPane]);

  /** Starts a new chat in `projectId` in the focused pane. */
  const startNewSession = useCallback((projectId: string | null, openInPrimary: () => void) => {
    if (!isSplitActive || storedFocusedPane !== 'secondary') {
      openInPrimary();
      return;
    }
    setSecondary({ sessionId: null, projectId });
    setSecondaryNewSessionTrigger((previous) => previous + 1);
  }, [isSplitActive, storedFocusedPane]);

  /**
   * Points the right pane at another session in its project: its new chat was
   * given a session id, or a message in it was forked.
   */
  const showInSecondary = useCallback((sessionId: string) => {
    setSecondary((previous) => ({ ...previous, sessionId }));
  }, []);

  // The left pane can also be moved by the URL (a notification, a fork, the
  // back button). If it lands on the right pane's session, the right pane
  // gives it up, so one conversation never runs in two chats. Only a move of
  // the left pane counts: the narrowing swap briefly gives the right pane the
  // left pane's session before the URL catches up, and must not be undone.
  const previousPrimarySessionIdRef = useRef(primary.sessionId);
  useEffect(() => {
    const primaryMoved = previousPrimarySessionIdRef.current !== primary.sessionId;
    previousPrimarySessionIdRef.current = primary.sessionId;
    if (primaryMoved && primary.sessionId && primary.sessionId === secondary.sessionId) {
      setSecondary({ sessionId: null, projectId: secondary.projectId });
      setStoredFocusedPane('primary');
    }
  }, [primary.sessionId, secondary.projectId, secondary.sessionId]);

  /** A deleted session must not stay in the right pane; it drops to a new chat. */
  const forgetSession = useCallback((sessionId: string) => {
    setSecondary((previous) => (
      previous.sessionId === sessionId ? { sessionId: null, projectId: previous.projectId } : previous
    ));
  }, []);

  return {
    isSplitAvailable: isWide,
    isSplitActive,
    secondary,
    focusedPane,
    dividerRatio,
    secondaryNewSessionTrigger,
    openSplit,
    closeSplit,
    focusPane,
    setDividerRatio,
    openSession,
    startNewSession,
    showInSecondary,
    forgetSession,
  };
}
