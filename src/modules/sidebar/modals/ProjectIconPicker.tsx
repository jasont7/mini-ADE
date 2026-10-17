import { useState } from 'react';
import type { CSSProperties } from 'react';
import { RotateCcw, X } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { PROJECT_ICON_GLYPHS, PROJECT_TILE_COLORS } from '@/shared/constants';
import { cn } from '@/shared/utils';
import type { Project, ProjectAppearance, ProjectIcon } from '@/shared/types';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';
import ProjectMonogram from '@/modules/sidebar/ProjectMonogram';

// A starting set leaning towards what projects tend to be about. Anything else
// can be typed or pasted into the field below the grid.
const SUGGESTED_EMOJIS = [
  '🚀', '🧠', '🤖', '🛠️', '⚙️', '🧪', '🔬', '🧬',
  '📚', '🎓', '📧', '💬', '📸', '🎨', '🎵', '🎬',
  '🌐', '📱', '💻', '🗄️', '☁️', '🔒', '🐛', '⚡',
  '🔥', '🌱', '🌊', '⭐', '❤️', '🏠', '🏢', '✈️',
  '🎮', '💰', '📈', '🛒', '📝', '📦', '🧩', '🎯',
];

// The project's TypeScript lib predates Intl.Segmenter, so only the slice used
// here is declared. Every browser the app supports has it.
type GraphemeSegmenter = new (
  locale: undefined,
  options: { granularity: 'grapheme' },
) => { segment: (input: string) => Iterable<{ segment: string }> };

/** The first user-perceived character, so a pasted flag or skin-toned emoji stays whole. */
const firstGrapheme = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter;
  if (Segmenter) {
    for (const { segment } of new Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)) {
      return segment;
    }
  }
  return Array.from(trimmed)[0] ?? '';
};

const isSameIcon = (left: ProjectIcon | null, right: ProjectIcon): boolean => (
  left?.kind === right.kind
  && (left.kind === 'emoji' ? left.emoji === (right as { emoji: string }).emoji : left.name === (right as { name: string }).name)
);

type ProjectIconPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  appearance: ProjectAppearance | null;
  /** Saves a change; a null icon goes back to the initials, a null colour to the default. */
  onChange: (change: Partial<ProjectAppearance>) => void;
};

/**
 * Rendered by SessionPane from a project's header: choose the background
 * colour of its tile, and the emoji or icon it shows instead of initials.
 */
export default function ProjectIconPicker({ open, onOpenChange, project, appearance, onChange }: ProjectIconPickerProps) {
  const icon = appearance?.icon ?? null;
  const color = appearance?.color ?? null;
  const isCompact = useCompactSidebar();
  // Which grid is showing. Opens on whatever kind the project already uses.
  const [tab, setTab] = useState<ProjectIcon['kind']>(icon?.kind ?? 'emoji');
  // The custom-emoji field's text; only its first character is ever saved.
  const [customEmoji, setCustomEmoji] = useState('');
  const customGrapheme = firstGrapheme(customEmoji);

  // Picking an icon finishes the job, so it closes. Picking a colour does not:
  // the icon is usually chosen next, against the new colour.
  const choose = (next: ProjectIcon | null) => {
    onChange({ icon: next });
    setCustomEmoji('');
    onOpenChange(false);
  };

  const cellClass = (selected: boolean) => cn(
    'flex aspect-square w-full items-center justify-center rounded-lg transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    selected ? 'bg-accent ring-2 ring-foreground/60' : 'hover:bg-accent active:bg-accent',
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="project-icon-picker-description"
        animationClassName={isCompact ? 'animate-bottom-sheet-content-show motion-reduce:animate-none' : undefined}
        className={cn(
          'flex max-h-[85vh] flex-col p-4',
          isCompact
            ? 'bottom-0 left-0 top-auto max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-2xl border-x-0 border-b-0 pb-safe-area-inset-bottom'
            : 'max-w-sm',
        )}
      >
        <DialogTitle>Project icon and colour</DialogTitle>
        {isCompact && <div className="mx-auto mb-3 h-1 w-10 flex-shrink-0 rounded-full bg-muted-foreground/30" aria-hidden="true" />}

        <div className="flex flex-shrink-0 items-center gap-3">
          <ProjectMonogram projectId={project.projectId} name={project.displayName} appearance={appearance} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{project.displayName}</p>
            <p id="project-icon-picker-description" className="text-xs text-muted-foreground">
              Shown on its tile in the sidebar
            </p>
          </div>
          {!isCompact && (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-shrink-0 flex-wrap gap-1.5" role="radiogroup" aria-label="Tile colour">
          <button
            type="button"
            role="radio"
            aria-checked={color === null}
            aria-label="Default colour"
            title="Default"
            onClick={() => onChange({ color: null })}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground',
              color === null && 'ring-2 ring-foreground ring-offset-2 ring-offset-popover',
            )}
          >
            <RotateCcw className="h-3 w-3" />
          </button>
          {Object.entries(PROJECT_TILE_COLORS).map(([key, swatch]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={color === key}
              aria-label={swatch.label}
              title={swatch.label}
              onClick={() => onChange({ color: key })}
              style={{ '--tile-hue': swatch.hue, '--tile-chroma': swatch.chroma } as CSSProperties}
              className={cn(
                'h-7 w-7 rounded-full border border-black/5 transition-transform hover:scale-110',
                // A shade deeper than the tile's own fill, so the palest
                // colours still read as distinct circles.
                'bg-[hsl(var(--tile-hue)_calc(48%*var(--tile-chroma))_80%)] dark:bg-[hsl(var(--tile-hue)_calc(28%*var(--tile-chroma))_30%)]',
                color === key && 'ring-2 ring-foreground ring-offset-2 ring-offset-popover',
              )}
            />
          ))}
        </div>

        <div className="mt-4 flex flex-shrink-0 gap-1" role="tablist" aria-label="Icon type">
          {(['emoji', 'glyph'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={tab === option}
              onClick={() => setTab(option)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                tab === option ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {option === 'emoji' ? 'Emoji' : 'Icons'}
            </button>
          ))}
        </div>

        <div className="mt-3 min-h-0 overflow-y-auto overscroll-contain">
          {tab === 'emoji' ? (
            <>
              <div className="grid grid-cols-8 gap-1">
                {SUGGESTED_EMOJIS.map((emoji) => {
                  const option: ProjectIcon = { kind: 'emoji', emoji };
                  return (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={`Use ${emoji}`}
                      onClick={() => choose(option)}
                      className={cn(cellClass(isSameIcon(icon, option)), 'text-xl')}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (customGrapheme) choose({ kind: 'emoji', emoji: customGrapheme });
                }}
              >
                <input
                  type="text"
                  value={customEmoji}
                  onChange={(event) => setCustomEmoji(event.target.value)}
                  placeholder="Or type any emoji"
                  aria-label="Custom emoji"
                  autoComplete="off"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
                  // 16px keeps iOS Safari from zooming the viewport on focus.
                  style={{ fontSize: '16px' }}
                />
                <button
                  type="submit"
                  disabled={!customGrapheme}
                  className="h-9 rounded-lg bg-foreground px-3 text-sm font-medium text-background transition-opacity disabled:opacity-40"
                >
                  {customGrapheme ? `Use ${customGrapheme}` : 'Use'}
                </button>
              </form>
            </>
          ) : (
            <div className="grid grid-cols-8 gap-1">
              {Object.entries(PROJECT_ICON_GLYPHS).map(([name, Glyph]) => {
                const option: ProjectIcon = { kind: 'glyph', name };
                return (
                  <button
                    key={name}
                    type="button"
                    aria-label={`Use the ${name} icon`}
                    title={name}
                    onClick={() => choose(option)}
                    className={cn(cellClass(isSameIcon(icon, option)), 'text-foreground/80')}
                  >
                    <Glyph className="h-5 w-5" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => choose(null)}
          disabled={!icon}
          className="mt-4 flex h-10 flex-shrink-0 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Use initials
        </button>
      </DialogContent>
    </Dialog>
  );
}
