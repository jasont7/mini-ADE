import { memo } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { PROJECT_ICON_GLYPHS, PROJECT_TILE_COLORS } from '@/shared/constants';
import { cn } from '@/shared/utils';
import type { ProjectAppearance } from '@/shared/types';

// Hues for project tiles nobody has picked a colour for. Pure greens and blues
// are left out: those carry the unread and running states, and a default tile
// should never be mistaken for a status. A user may still choose them.
const TILE_HUES = [12, 28, 42, 58, 168, 186, 262, 284, 306, 326, 344];

/** Two letters from the name's words or camel humps: "mini-ADE" is MA, "BioResearch" BR, "SJC" SJ. */
const getMonogram = (name: string): string => {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s\-_.]+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
};

/** Hashes the stable project id, not the name, so a rename keeps the colour. */
const getHue = (projectId: string): number => {
  let hash = 0;
  for (let index = 0; index < projectId.length; index += 1) {
    hash = (hash * 31 + projectId.charCodeAt(index)) | 0;
  }
  return TILE_HUES[Math.abs(hash) % TILE_HUES.length];
};

type ProjectMonogramProps = {
  projectId: string;
  name: string;
  /** The user's chosen icon (replacing the initials) and colour, if any. */
  appearance?: ProjectAppearance | null;
  /** xs tags a session row, md is a rail tile, lg previews the picker's choice. */
  size: 'xs' | 'md' | 'lg';
  className?: string;
};

const SIZE_CLASSES: Record<ProjectMonogramProps['size'], { tile: string; initials: string; emoji: string; glyph: string }> = {
  xs: { tile: 'h-3.5 w-3.5 rounded-[4px]', initials: 'text-[7px] leading-none', emoji: 'text-[9px] leading-none', glyph: 'h-2.5 w-2.5' },
  md: { tile: 'h-9 w-9 rounded-[10px]', initials: 'text-[13px]', emoji: 'text-[19px] leading-none', glyph: 'h-[18px] w-[18px]' },
  lg: { tile: 'h-14 w-14 rounded-2xl', initials: 'text-lg', emoji: 'text-[30px] leading-none', glyph: 'h-7 w-7' },
};

/**
 * Rendered by ProjectRail for each tile, by SessionPaneRow to tag a session
 * with its project, and by the pane header and ProjectIconPicker. Shows the
 * project's chosen emoji or icon on its own colour, or its initials.
 */
function ProjectMonogram({ projectId, name, appearance, size, className }: ProjectMonogramProps) {
  const classes = SIZE_CLASSES[size];
  const icon = appearance?.icon ?? null;
  const color = appearance?.color ? PROJECT_TILE_COLORS[appearance.color] : undefined;
  const tileStyle = {
    '--tile-hue': color?.hue ?? getHue(projectId),
    '--tile-chroma': color?.chroma ?? 1,
  } as CSSProperties;
  const Glyph = icon?.kind === 'glyph' ? PROJECT_ICON_GLYPHS[icon.name] : undefined;

  let content: ReactNode;
  if (icon?.kind === 'emoji') {
    content = <span className={classes.emoji}>{icon.emoji}</span>;
  } else if (Glyph) {
    content = <Glyph className={classes.glyph} strokeWidth={size === 'xs' ? 2.5 : 2} />;
  } else {
    content = <span className={classes.initials}>{getMonogram(name)}</span>;
  }

  return (
    <span
      aria-hidden
      style={tileStyle}
      className={cn(
        'flex flex-shrink-0 select-none items-center justify-center font-semibold tracking-tight',
        // Chroma scales saturation, so 0 gives the neutral grey tile.
        'bg-[hsl(var(--tile-hue)_calc(48%*var(--tile-chroma))_88%)] text-[hsl(var(--tile-hue)_calc(45%*var(--tile-chroma))_28%)]',
        'dark:bg-[hsl(var(--tile-hue)_calc(28%*var(--tile-chroma))_24%)] dark:text-[hsl(var(--tile-hue)_calc(60%*var(--tile-chroma))_80%)]',
        classes.tile,
        className,
      )}
    >
      {content}
    </span>
  );
}

export default memo(ProjectMonogram);
