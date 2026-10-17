import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { PROJECT_ICON_GLYPHS, PROJECT_TILE_COLORS } from '@/shared/constants';
import type { ProjectAppearance, ProjectIcon } from '@/shared/types';
import { readUserPreference, subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';

const readStoredIcons = (): unknown => readUserPreference<unknown>('projectIcons', null);
const readStoredColors = (): unknown => readUserPreference<unknown>('projectColors', null);

const readRecord = (stored: unknown): Record<string, unknown> => (
  stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, unknown> : {}
);

/**
 * Keeps only well-formed icon entries from the stored preference.
 *
 * The value arrives from the server as untyped JSON, possibly written by an
 * older or newer build, so anything unrecognised (an unknown glyph name, an
 * empty emoji) is dropped and that project falls back to its initials.
 */
export function parseProjectIcons(stored: unknown): ReadonlyMap<string, ProjectIcon> {
  const icons = new Map<string, ProjectIcon>();
  for (const [projectId, value] of Object.entries(readRecord(stored))) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    if (entry.kind === 'emoji' && typeof entry.emoji === 'string' && entry.emoji.trim()) {
      icons.set(projectId, { kind: 'emoji', emoji: entry.emoji });
    } else if (entry.kind === 'glyph' && typeof entry.name === 'string' && entry.name in PROJECT_ICON_GLYPHS) {
      icons.set(projectId, { kind: 'glyph', name: entry.name });
    }
  }
  return icons;
}

/** Keeps only colour entries naming a known palette colour; the rest fall back to the default. */
export function parseProjectColors(stored: unknown): ReadonlyMap<string, string> {
  const colors = new Map<string, string>();
  for (const [projectId, value] of Object.entries(readRecord(stored))) {
    if (typeof value === 'string' && value in PROJECT_TILE_COLORS) {
      colors.set(projectId, value);
    }
  }
  return colors;
}

/**
 * Each project's chosen tile icon and colour, and a setter that changes either
 * (null clears a choice). Both live in the synced preference store, so a
 * change on the desktop shows up on the phone after its next load. Projects
 * the user never customised are simply absent from the map.
 */
export function useProjectAppearance() {
  // The store hands back the same objects until a preference changes, so these
  // are stable snapshots, and the merge below is memoised on them.
  const storedIcons = useSyncExternalStore(subscribeToUserPreferences, readStoredIcons);
  const storedColors = useSyncExternalStore(subscribeToUserPreferences, readStoredColors);

  const appearance = useMemo(() => {
    const icons = parseProjectIcons(storedIcons);
    const colors = parseProjectColors(storedColors);
    const merged = new Map<string, ProjectAppearance>();
    for (const projectId of new Set([...icons.keys(), ...colors.keys()])) {
      merged.set(projectId, { icon: icons.get(projectId) ?? null, color: colors.get(projectId) ?? null });
    }
    return merged as ReadonlyMap<string, ProjectAppearance>;
  }, [storedColors, storedIcons]);

  const setProjectAppearance = useCallback((projectId: string, change: Partial<ProjectAppearance>) => {
    if ('icon' in change) {
      const icons: Record<string, ProjectIcon> = Object.fromEntries(parseProjectIcons(readStoredIcons()));
      if (change.icon) icons[projectId] = change.icon;
      else delete icons[projectId];
      writeUserPreference('projectIcons', icons);
    }
    if ('color' in change) {
      const colors: Record<string, string> = Object.fromEntries(parseProjectColors(readStoredColors()));
      if (change.color) colors[projectId] = change.color;
      else delete colors[projectId];
      writeUserPreference('projectColors', colors);
    }
  }, []);

  return { appearance, setProjectAppearance };
}
