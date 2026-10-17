import { Check, ClipboardCheck, Folder, GitBranch, LayoutGrid, MessageSquare, MonitorPlay, Terminal, type LucideIcon } from 'lucide-react';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppTab } from '@/shared/types';
import { cn } from '@/shared/utils';
import { usePlugins, PluginIcon } from '@/modules/plugins';

type WorkspaceViewMenuProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
  shouldShowBrowserTab: boolean;
};

type BuiltInView = {
  kind: 'builtin';
  id: AppTab;
  labelKey: string;
  icon: LucideIcon;
};

type PluginView = {
  kind: 'plugin';
  id: AppTab;
  label: string;
  pluginName: string;
  iconFile: string;
};

type ViewDefinition = BuiltInView | PluginView;

const BASE_VIEWS: BuiltInView[] = [
  { kind: 'builtin', id: 'chat',  labelKey: 'tabs.chat',  icon: MessageSquare },
  { kind: 'builtin', id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { kind: 'builtin', id: 'files', labelKey: 'tabs.files', icon: Folder },
  { kind: 'builtin', id: 'git',   labelKey: 'tabs.git',   icon: GitBranch },
];

const BROWSER_VIEW: BuiltInView = {
  kind: 'builtin',
  id: 'browser',
  labelKey: 'tabs.browser',
  icon: MonitorPlay,
};

const TASKS_VIEW: BuiltInView = {
  kind: 'builtin',
  id: 'tasks',
  labelKey: 'tabs.tasks',
  icon: ClipboardCheck,
};

/**
 * Rendered by WorkspaceHeader: one icon button whose dropdown lists every
 * workspace view (chat, shell, files, source control, browser, tasks and
 * enabled plugins). It replaced the always-visible tab strip, which took a row
 * of the header for destinations that are rarely switched to.
 */
export default function WorkspaceViewMenu({
  activeTab,
  setActiveTab,
  shouldShowTasksTab,
  shouldShowBrowserTab,
}: WorkspaceViewMenuProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();
  // Whether the dropdown is showing.
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const builtInViews: BuiltInView[] = [
    ...BASE_VIEWS,
    ...(shouldShowBrowserTab ? [BROWSER_VIEW] : []),
    ...(shouldShowTasksTab ? [TASKS_VIEW] : []),
  ];

  const pluginViews: PluginView[] = plugins
    .filter((p) => p.enabled)
    .map((p) => ({
      kind: 'plugin',
      id: `plugin:${p.name}` as AppTab,
      label: p.displayName,
      pluginName: p.name,
      iconFile: p.icon,
    }));

  const views: ViewDefinition[] = [...builtInViews, ...pluginViews];
  const menuLabel = t('tabs.views', { defaultValue: 'Workspace views' });

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const closeOnOutsidePointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Registered on window in the capture phase so it runs before the
        // chat's document-level Escape-to-stop, which skips handled events.
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    // The active item is where keyboard focus starts, like a native select.
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();

    document.addEventListener('mousedown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape, { capture: true });
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape, { capture: true });
    };
  }, [isOpen]);

  const selectView = (id: AppTab) => {
    setActiveTab(id);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;

    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'Tab') {
      setIsOpen(false);
      return;
    } else return;

    event.preventDefault();
    items[nextIndex]?.focus();
  };

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={menuLabel}
        title={menuLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors',
          'hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60',
          isOpen && 'bg-accent text-foreground',
        )}
      >
        <LayoutGrid className="h-4 w-4" />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          onKeyDown={handleMenuKeyDown}
          className="animate-in fade-in-0 zoom-in-95 absolute right-0 top-full z-50 mt-1.5 min-w-[200px] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {views.map((view, index) => {
            const isActive = view.id === activeTab;
            const displayLabel = view.kind === 'builtin' ? t(view.labelKey) : view.label;

            return (
              <Fragment key={`${view.id}-${index}`}>
                {index === builtInViews.length && pluginViews.length > 0 && (
                  <div aria-hidden="true" className="mx-2 my-1 h-px bg-border" />
                )}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => selectView(view.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-none transition-colors',
                    'hover:bg-accent focus-visible:bg-accent',
                    isActive ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {view.kind === 'builtin' ? (
                    <view.icon className="h-4 w-4 shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                  ) : (
                    <PluginIcon
                      pluginName={view.pluginName}
                      iconFile={view.iconFile}
                      className="flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{displayLabel}</span>
                  {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
