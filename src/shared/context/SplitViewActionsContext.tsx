import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

import type { SplitPaneTarget } from '@/shared/types';

/**
 * The one split-view action the sidebar needs: "Open in split view" on a
 * session row.
 *
 * Split view is owned by the project-workspace module, which renders the
 * sidebar. Importing the workspace barrel back from the sidebar would make the
 * two modules import each other, so the action is handed down through this
 * context instead of being threaded through every sidebar row component.
 */
type SplitViewActions = {
  /** False below the split-view breakpoint, where the action is hidden. */
  canOpenInSplitView: boolean;
  openInSplitView: (target: SplitPaneTarget) => void;
};

const UNAVAILABLE: SplitViewActions = {
  canOpenInSplitView: false,
  openInSplitView: () => {},
};

const SplitViewActionsContext = createContext<SplitViewActions>(UNAVAILABLE);

/** Rendered by the project-workspace module's ProjectsStateProvider to expose its split-view action to the sidebar module. */
export function SplitViewActionsProvider({
  value,
  children,
}: {
  value: SplitViewActions;
  children: ReactNode;
}) {
  return <SplitViewActionsContext.Provider value={value}>{children}</SplitViewActionsContext.Provider>;
}

/** Used by the sidebar module's session options menu to offer "Open in split view". Outside a provider the action is unavailable. */
export function useSplitViewActions(): SplitViewActions {
  return useContext(SplitViewActionsContext);
}
