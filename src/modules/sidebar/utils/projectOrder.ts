import type { Project, RailSections } from '@/shared/types';

/**
 * Splits projects into the rail's sections, each in the user's dragged order.
 *
 * `projects` arrives already sorted by the user's sort setting (name or date),
 * and that is the order for anything the user has never dragged, such as a
 * project created since. Those go after the ones with a saved position, so a
 * new project never pushes an arranged one out of place.
 */
export function arrangeRailSections(projects: Project[], savedOrder: readonly string[]): RailSections {
  const position = new Map(savedOrder.map((projectId, index) => [projectId, index]));

  const arrange = (section: Project[]): Project[] => {
    const placed = section
      .filter((project) => position.has(project.projectId))
      .sort((a, b) => position.get(a.projectId)! - position.get(b.projectId)!);
    const unplaced = section.filter((project) => !position.has(project.projectId));
    return [...placed, ...unplaced];
  };

  return {
    starred: arrange(projects.filter((project) => project.isStarred)),
    regular: arrange(projects.filter((project) => !project.isStarred)),
  };
}

/**
 * The order to save after dragging `activeId` onto `overId`, or null when the
 * drop does not reorder anything (dropped on itself, or into the other
 * section).
 *
 * Saves every project in its displayed position, both sections together, so
 * that once a project is arranged it keeps that place relative to the others
 * even if it is later starred or unstarred.
 */
export function reorderRailSections(sections: RailSections, activeId: string, overId: string): string[] | null {
  if (activeId === overId) return null;

  const move = (section: Project[]): Project[] | null => {
    const from = section.findIndex((project) => project.projectId === activeId);
    const to = section.findIndex((project) => project.projectId === overId);
    if (from === -1 || to === -1) return null;
    const next = [...section];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  };

  const starred = move(sections.starred);
  const regular = starred ? sections.regular : move(sections.regular);
  if (!starred && !regular) return null;

  return [...(starred ?? sections.starred), ...(regular ?? sections.regular)]
    .map((project) => project.projectId);
}
