import { readStorage, removeStorage, writeStorage } from '../../utils/safeStorage';
import { parseBootstrap, type Bootstrap, type LiveProjectRef } from './liveApi';
import { SPACE_NAME, SPACES } from './spaces';

/**
 * The last good state of the bar, kept in this browser's localStorage so that a reload paints the bar once, in its final
 * layout: the space names, the space icons (image data URIs) and the projects that are not archived, with their icons.
 * It has the shape of the bootstrap answer and is read back through the same parser (so a name, an icon or a project that
 * does not pass is dropped, and anything that is not JSON is ignored). Per-viewer convenience data on a private page:
 * nothing else goes into storage. Every access is guarded (safeStorage never throws).
 */
const KEY = 'dashboards-bar-v1';

/** The cache as the bootstrap parser reads it. */
function shaped(bootstrap: Bootstrap, projects: readonly LiveProjectRef[]) {
  return {
    enabled: true,
    spaces: SPACES.map((id) => ({ id, name: bootstrap.spaceNames[id] ?? SPACE_NAME[id].en, icon: bootstrap.spaceIcons[id] ?? null })),
    projects: projects.map(({ id, name, icon }) => ({ id, name, icon })),
  };
}

/** What the last visit left, validated, or null when there is nothing usable. */
export function readBarCache(): Bootstrap | null {
  try {
    const raw = readStorage('local', KEY);
    if (raw === null) return null;
    const parsed = parseBootstrap(JSON.parse(raw));
    return parsed?.enabled ? parsed : null;
  } catch {
    return null;
  }
}

/** Keeps the bar's state from a live answer, with the projects as they are now. */
export function writeBarCache(bootstrap: Bootstrap, projects: readonly LiveProjectRef[] = bootstrap.projects): void {
  try {
    writeStorage('local', KEY, JSON.stringify(shaped(bootstrap, projects)));
  } catch {
    // Nothing to keep it in: the next load shows the placeholders, which is all that is lost.
  }
}

/** Forgets it (the bootstrap said the dashboards are not on the API). */
export function clearBarCache(): void {
  removeStorage('local', KEY);
}
