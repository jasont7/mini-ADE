import { Columns2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppTab, Project, ProjectSession } from '@/shared/types';
import { cn } from '@/shared/utils';
import MobileMenuButton from '@/modules/project-workspace/MobileMenuButton';
import WorkspaceTitle from '@/modules/project-workspace/WorkspaceTitle';
import WorkspaceViewMenu from '@/modules/project-workspace/WorkspaceViewMenu';

type WorkspaceHeaderProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
  shouldShowBrowserTab: boolean;
  isMobile: boolean;
  onMenuClick: () => void;
  /** Only on wide screens in the Chat view. */
  showSplitToggle: boolean;
  isSplitActive: boolean;
  onToggleSplit: () => void;
};

/** Rendered by WorkspaceMain to show the workspace title, the split-view toggle and the views menu in one row. */
export default function WorkspaceHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  shouldShowBrowserTab,
  isMobile,
  onMenuClick,
  showSplitToggle,
  isSplitActive,
  onToggleSplit,
}: WorkspaceHeaderProps) {
  const { t } = useTranslation();
  const splitLabel = isSplitActive
    ? t('splitView.close', { defaultValue: 'Close split view' })
    : t('splitView.open', { defaultValue: 'Split view' });

  // `relative z-30`: backdrop-blur makes the header its own stacking context,
  // so without a z-index of its own the views dropdown renders underneath the
  // transcript that follows it.
  return (
    <header className="pwa-header-safe relative z-30 flex-shrink-0 border-b border-border/60 bg-background/95 px-3 py-1.5 backdrop-blur-sm sm:px-4 sm:py-2">
      <div className="flex min-w-0 items-center gap-2">
        {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}
        <WorkspaceTitle
          activeTab={activeTab}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          shouldShowTasksTab={shouldShowTasksTab}
        />

        {showSplitToggle && (
          <button
            type="button"
            onClick={onToggleSplit}
            aria-label={splitLabel}
            title={splitLabel}
            data-split-toggle={isSplitActive ? 'on' : 'off'}
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg outline-none transition-colors',
              'hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60',
              isSplitActive ? 'bg-accent text-foreground' : 'text-muted-foreground',
            )}
          >
            <Columns2 className="h-4 w-4" />
          </button>
        )}

        <WorkspaceViewMenu
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          shouldShowTasksTab={shouldShowTasksTab}
          shouldShowBrowserTab={shouldShowBrowserTab}
        />
      </div>
    </header>
  );
}
