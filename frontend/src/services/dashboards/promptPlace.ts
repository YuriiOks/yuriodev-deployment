import { isProjectPath, pageAt, PROJECTS_PATH } from '../../data/site';
import { spaceAt } from './spaces';
import type { SpaceId } from './types';

/** A name as a path segment: lower case, runs of other characters one '-', at most 24 characters ("Side project" is "side-project"). */
export function promptSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return Array.from(slug).slice(0, 24).join('').replace(/-+$/g, '');
}

export interface PromptNames {
  /** The name the server gives a space, if it renames it; a space it does not rename is run by its route slug. */
  readonly spaceName: (space: SpaceId) => string | undefined;
  /** A project's name by its id, if known. */
  readonly projectName: (id: string) => string | undefined;
}

/**
 * The place the dashboards' prompt runs, after "./": "dashboards" on the entrance, "dashboards/personal" on a space (its route slug, or
 * the server's name for it when the server renames it), "dashboards/calendar", "dashboards/projects/garden".
 */
export function promptPlace(pathname: string, names: PromptNames): string {
  if (isProjectPath(pathname)) {
    const id = decodeURIComponent(pathname.slice(PROJECTS_PATH.length + 1).replace(/\/+$/, ''));
    return `dashboards/projects/${promptSlug(names.projectName(id) ?? id) || 'project'}`;
  }
  if (pageAt(pathname)?.id === 'dashboards-money') return `dashboards/${promptSlug(names.spaceName('personal') ?? 'personal') || 'personal'}/money`;
  const space = spaceAt(pathname);
  if (space) return `dashboards/${promptSlug(names.spaceName(space) ?? space) || space}`;
  if (pageAt(pathname)?.id === 'dashboards-calendar') return 'dashboards/calendar';
  return 'dashboards';
}
