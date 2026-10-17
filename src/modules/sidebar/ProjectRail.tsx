import { memo, useState } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, Archive, Columns2, FolderPlus, Inbox, PanelLeftOpen, Settings, Sparkles } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { Project, ProjectActivitySummary, ProjectAppearance, RailSections } from '@/shared/types';
import ProjectMonogram from '@/modules/sidebar/ProjectMonogram';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';

const ALT_KEY_LABEL =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥' : 'Alt+';

const NO_ACTIVITY: ProjectActivitySummary = { running: 0, unread: 0 };

const describeActivity = ({ running, unread }: ProjectActivitySummary): string | null => {
  const parts = [
    running > 0 ? `${running} running` : null,
    unread > 0 ? `${unread} to review` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
};

type RailTileProps = {
  label: string;
  activity: ProjectActivitySummary;
  /** The scope the session pane is showing. */
  isViewing: boolean;
  /** Owns the session that is open in the main area. */
  isOpen: boolean;
  shortcut: string | null;
  onClick: () => void;
  /** The drag listeners and accessibility attributes of a sortable tile. */
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  /** Hides the tooltip while the tile is being dragged. */
  isDragging?: boolean;
  children: ReactNode;
};

/**
 * One tile on the rail. The ring is the point of the rail: a project with a run
 * in flight has a turning arc, so activity across every project is visible at
 * a glance without opening anything.
 */
function RailTile({ label, activity, isViewing, isOpen, shortcut, onClick, dragHandleProps, isDragging = false, children }: RailTileProps) {
  const isCompact = useCompactSidebar();
  const status = describeActivity(activity);
  const accessibleLabel = status ? `${label}, ${status}` : label;

  return (
    <div className="relative flex w-full justify-center">
      <Tooltip
        position="right"
        delay={150}
        // A tap fires hover on touch screens and the tooltip then sticks.
        content={isCompact || isDragging ? undefined : (
          <span className="block whitespace-nowrap text-left">
            <span className="font-medium">{label}</span>
            {shortcut && <span className="ml-2 opacity-60">{shortcut}</span>}
            {status && <span className="block opacity-75">{status}</span>}
          </span>
        )}
      >
        <button
          type="button"
          {...dragHandleProps}
          onClick={onClick}
          aria-label={accessibleLabel}
          aria-current={isViewing ? 'true' : undefined}
          className={cn(
            'relative flex h-11 w-11 items-center justify-center rounded-xl transition-transform duration-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95',
            // A long press starts a drag on touch; keep iOS from opening its
            // callout or selecting text underneath it.
            'select-none [-webkit-touch-callout:none]',
            // The tile the pane is showing gets a full outline, which reads the
            // same in one column or two. The open session's project, when the
            // pane is showing a different one, gets a faint outline instead.
            isViewing
              ? 'ring-2 ring-foreground'
              : isOpen && 'ring-1 ring-foreground/30',
            isDragging && 'scale-110 cursor-grabbing',
          )}
        >
          {activity.running > 0 && (
            <svg
              aria-hidden
              viewBox="0 0 44 44"
              className="absolute inset-0 h-11 w-11 text-blue-500"
            >
              <rect
                x="1.5"
                y="1.5"
                width="41"
                height="41"
                rx="12.5"
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.18"
                strokeWidth="2"
              />
              <rect
                x="1.5"
                y="1.5"
                width="41"
                height="41"
                rx="12.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                pathLength="100"
                strokeDasharray="24 76"
                className="rail-orbit activity-indicator"
              />
            </svg>
          )}
          <span className="flex items-center justify-center rounded-[10px]">
            {children}
          </span>
          {activity.unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-green-500 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-background">
              {activity.unread > 9 ? '9+' : activity.unread}
            </span>
          )}
          {activity.running > 1 && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-background">
              {activity.running}
            </span>
          )}
        </button>
      </Tooltip>
    </div>
  );
}

type RailButtonProps = {
  label: string;
  onClick: () => void;
  isActive?: boolean;
  children: ReactNode;
};

function RailButton({ label, onClick, isActive = false, children }: RailButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={isActive || undefined}
      className={cn(
        'group flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors',
        'hover:bg-accent/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isActive && 'bg-accent text-foreground',
      )}
    >
      {children}
    </button>
  );
}

type SortableRailTileProps = {
  project: Project;
  activity: ProjectActivitySummary;
  appearance: ProjectAppearance | undefined;
  isViewing: boolean;
  isOpen: boolean;
  shortcut: string | null;
  onSelect: (projectId: string) => void;
};

/** A project tile that can be dragged to a new place within its section. */
function SortableRailTile({ project, activity, appearance, isViewing, isOpen, shortcut, onSelect }: SortableRailTileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.projectId });

  return (
    <div
      ref={setNodeRef}
      // Translate only: the sortable strategy would otherwise also scale the
      // tile to the size of the one it is passing over.
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('relative w-full', isDragging && 'z-10 opacity-90')}
    >
      <RailTile
        label={project.displayName}
        activity={activity}
        isViewing={isViewing}
        isOpen={isOpen}
        shortcut={shortcut}
        onClick={() => onSelect(project.projectId)}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      >
        <ProjectMonogram projectId={project.projectId} name={project.displayName} appearance={appearance} size="md" />
      </RailTile>
    </div>
  );
}

type ProjectRailProps = {
  sections: RailSections;
  /** Lays the tiles out two to a row. */
  isTwoColumns: boolean;
  onToggleTwoColumns: () => void;
  /** Called after a drag with the dragged tile and the tile it was dropped on. */
  onReorder: (activeId: string, overId: string) => void;
  activityByProject: ReadonlyMap<string, ProjectActivitySummary>;
  projectAppearance: ReadonlyMap<string, ProjectAppearance>;
  totalActivity: ProjectActivitySummary;
  scopeProjectId: string | null;
  openProjectId: string | null;
  isArchiveOpen: boolean;
  isPaneCollapsed: boolean;
  updateAvailable: boolean;
  restartRequired: boolean;
  onSelectScope: (projectId: string | null) => void;
  onToggleArchive: () => void;
  onCreateProject: () => void;
  onExpandPane: () => void;
  onShowSettings: () => void;
  onShowVersionModal: () => void;
  t: TFunction;
};

/**
 * Rendered by Sidebar as the always-visible column of project tiles, even when
 * the session pane is collapsed. Tiles sit in two sections, favourites then the
 * rest, and can be dragged to a new place within their section.
 */
function ProjectRail({
  sections,
  isTwoColumns,
  onToggleTwoColumns,
  onReorder,
  activityByProject,
  projectAppearance,
  totalActivity,
  scopeProjectId,
  openProjectId,
  isArchiveOpen,
  isPaneCollapsed,
  updateAvailable,
  restartRequired,
  onSelectScope,
  onToggleArchive,
  onCreateProject,
  onExpandPane,
  onShowSettings,
  onShowVersionModal,
  t,
}: ProjectRailProps) {
  const isAllViewing = scopeProjectId === null && !isArchiveOpen;
  // Mouse drags start after a few pixels so a click still selects. Touch drags
  // need a long press, so a swipe keeps scrolling the rail.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  // Whether a tile is mid-drag. The rail stops taking touch scrolls meanwhile,
  // or the finger moving the tile would scroll the list out from under it.
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setIsDragging(false);
    if (over) {
      onReorder(String(active.id), String(over.id));
    }
  };

  const renderSection = (projects: Project[], shortcutOffset: number) => (
    <SortableContext items={projects.map((project) => project.projectId)} strategy={rectSortingStrategy}>
      <div className={cn(isTwoColumns ? 'grid grid-cols-2 gap-x-1 gap-y-1.5 px-1.5' : 'flex flex-col items-center gap-1.5')}>
        {projects.map((project, index) => {
          const position = shortcutOffset + index;
          return (
            <SortableRailTile
              key={project.projectId}
              project={project}
              activity={activityByProject.get(project.projectId) ?? NO_ACTIVITY}
              appearance={projectAppearance.get(project.projectId)}
              isViewing={scopeProjectId === project.projectId && !isArchiveOpen}
              isOpen={openProjectId === project.projectId}
              shortcut={position < 9 ? `${ALT_KEY_LABEL}${position + 1}` : null}
              onSelect={onSelectScope}
            />
          );
        })}
      </div>
    </SortableContext>
  );

  return (
    <nav
      aria-label={t('projects.title', 'Projects')}
      className={cn(
        'flex h-full flex-shrink-0 flex-col items-center bg-muted/40 pb-2 pt-2',
        isTwoColumns ? 'w-[108px]' : 'w-14',
      )}
    >
      <RailTile
        label={t('navigator.allSessions', 'All sessions')}
        activity={totalActivity}
        isViewing={isAllViewing}
        isOpen={false}
        shortcut={`${ALT_KEY_LABEL}0`}
        onClick={() => onSelectScope(null)}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-foreground/85 text-background">
          <Inbox className="h-4 w-4" />
        </span>
      </RailTile>

      <div className="nav-divider my-2 w-8 flex-shrink-0" />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setIsDragging(false)}
      >
        <div
          className={cn(
            'min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            isDragging && 'touch-none',
          )}
        >
          {renderSection(sections.starred, 0)}
          {sections.starred.length > 0 && sections.regular.length > 0 && (
            <div className="nav-divider mx-auto my-1.5 w-5" />
          )}
          {renderSection(sections.regular, sections.starred.length)}
        </div>
      </DndContext>

      <div className="mt-2 flex flex-shrink-0 flex-col items-center gap-1">
        <RailButton
          label="Two-column projects"
          onClick={onToggleTwoColumns}
          isActive={isTwoColumns}
        >
          <Columns2 className="h-4 w-4" />
        </RailButton>
        <RailButton label={t('tooltips.createProject')} onClick={onCreateProject}>
          <FolderPlus className="h-4 w-4" />
        </RailButton>
        <RailButton
          label={t('search.archiveOnlyTooltip', 'Archive')}
          onClick={onToggleArchive}
          isActive={isArchiveOpen}
        >
          <Archive className="h-4 w-4" />
        </RailButton>
        {isPaneCollapsed && (
          <RailButton label={t('common:versionUpdate.ariaLabels.showSidebar')} onClick={onExpandPane}>
            <PanelLeftOpen className="h-4 w-4" />
          </RailButton>
        )}
        {restartRequired && (
          <div
            className="relative flex h-9 w-9 items-center justify-center"
            role="status"
            aria-label={t('version.restartRequired')}
            title={t('version.restartRequired')}
          >
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
        )}
        {updateAvailable && (
          <RailButton label={t('common:versionUpdate.ariaLabels.updateAvailable')} onClick={onShowVersionModal}>
            <Sparkles className="h-4 w-4 text-blue-500" />
          </RailButton>
        )}
        {/* The divider must directly precede Settings: public/mini-ade.js finds
            the Settings button by that sibling and inserts Restart server. */}
        <div className="nav-divider my-1 w-6" />
        <button
          type="button"
          onClick={onShowSettings}
          aria-label={t('actions.settings')}
          title={t('actions.settings')}
          className="group flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}

export default memo(ProjectRail);
