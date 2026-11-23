import { useSyncExternalStore } from 'react';
import { getBarSeed, getBootstrapSnapshot, subscribeBootstrap } from '../services/dashboards/bootstrapStore';
import type { LiveProjectRef } from '../services/dashboards/liveApi';
import { getProjectsSnapshot, subscribeProjects } from '../services/dashboards/projectsStore';

export interface BarData {
  /**
   * `placeholder`: nothing is known yet and nothing was kept from the last visit, so the bar holds quiet fixed-size blocks;
   * `live`: real data (from the answer, or, until it comes, from the last visit); `sample`: the bundled names.
   */
  readonly phase: 'placeholder' | 'live' | 'sample';
  /** The projects that are not archived, with their icons: the answer's list, refined by the shared list once it is loaded. */
  readonly projects: readonly LiveProjectRef[];
}

const NONE: readonly LiveProjectRef[] = [];

/**
 * What the bar shows for the spaces and the projects, so that it paints once, in its final layout. The bootstrap answer
 * already lists the projects, so the pills come from it (or, before it, from the last visit's cache); the shared projects
 * list (GET /projects) only takes over when it has loaded, with the same content, so nothing steps in later.
 */
export function useBarData(): BarData {
  const snapshot = useSyncExternalStore(subscribeBootstrap, getBootstrapSnapshot, getBootstrapSnapshot);
  const store = useSyncExternalStore(subscribeProjects, getProjectsSnapshot, getProjectsSnapshot);
  if (snapshot.status === 'ready') {
    const bootstrap = snapshot.bootstrap?.enabled ? snapshot.bootstrap : null;
    if (!bootstrap) return { phase: 'sample', projects: NONE };
    if (store.status === 'ready') {
      return { phase: 'live', projects: store.projects.filter((project) => !project.archived).map(({ id, name, icon }) => ({ id, name, icon })) };
    }
    return { phase: 'live', projects: bootstrap.projects };
  }
  const seed = getBarSeed();
  return seed ? { phase: 'live', projects: seed.projects } : { phase: 'placeholder', projects: NONE };
}
