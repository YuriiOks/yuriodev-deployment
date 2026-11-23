import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ApiError, LiveProject } from '../services/dashboards/liveApi';
import { addProject, changeProject, getProjectsSnapshot, loadProjects, refreshProjects, subscribeProjects } from '../services/dashboards/projectsStore';
import { useDashboardMode } from './useDashboardMode';

export interface Projects {
  readonly status: 'loading' | 'ready' | 'error';
  /** Every project the server lists, archived ones included (the hub and the bar show only the others). */
  readonly projects: readonly LiveProject[];
  /** The projects that are not archived, in the server's order. */
  readonly active: readonly LiveProject[];
  readonly reload: () => void;
  /** Creates a project; resolves to the new one, or the error (status 409 is a name clash). */
  readonly create: (name: string, icon?: string | null) => Promise<LiveProject | ApiError>;
  /** Renames, re-icons or archives a project; resolves to null on success. */
  readonly update: (id: string, patch: Partial<{ name: string; archived: boolean; icon: string | null }>) => Promise<ApiError | null>;
}

const NONE: readonly LiveProject[] = [];

/**
 * The shared projects list (services/dashboards/projectsStore.ts), live data only: on the sample data there are no
 * projects and nothing is asked. `fresh` asks again on mount (the hub: its counters move as tasks change); the bar
 * only needs the list to exist.
 */
export function useProjects({ fresh = false }: { fresh?: boolean } = {}): Projects {
  const { mode } = useDashboardMode();
  const snapshot = useSyncExternalStore(subscribeProjects, getProjectsSnapshot, getProjectsSnapshot);
  const live = mode === 'live';

  useEffect(() => {
    if (!live) return;
    if (fresh) void refreshProjects();
    else loadProjects();
  }, [live, fresh]);

  const reload = useCallback(() => void refreshProjects(), []);
  const create = useCallback((name: string, icon?: string | null) => addProject(name, icon ?? null), []);
  const update = useCallback((id: string, patch: Partial<{ name: string; archived: boolean; icon: string | null }>) => changeProject(id, patch), []);

  if (!live) return { status: 'ready', projects: NONE, active: NONE, reload, create, update };
  const status = snapshot.status === 'ready' ? 'ready' : snapshot.status === 'error' ? 'error' : 'loading';
  return { status, projects: snapshot.projects, active: snapshot.projects.filter((project) => !project.archived), reload, create, update };
}
