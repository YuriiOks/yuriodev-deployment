import { updateBarCacheProjects } from './bootstrapStore';
import { ApiError, createProject, fetchProjects, patchProject, type LiveProject } from './liveApi';

/**
 * The user's projects, ONE client-side list for the whole app: the hub's cards, a project's page and the bar's pills all
 * read it, and a create, rename, icon change or archive updates it in place, so every one of them follows at once
 * (no reload, no stale name in the prompt). It is read with GET /projects, the full list with counters and archived
 * ones; `loadProjects` asks when nothing is loaded yet, `refreshProjects` asks again and keeps what it has while it does.
 */
export interface ProjectsSnapshot {
  /** `idle` until the first ask; `error` only while there is nothing to show (a failed refresh keeps the old list). */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly projects: readonly LiveProject[];
}

const IDLE: ProjectsSnapshot = { status: 'idle', projects: [] };

let snapshot: ProjectsSnapshot = IDLE;
let generation = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: ProjectsSnapshot) {
  snapshot = next;
  if (next.status === 'ready') updateBarCacheProjects(next.projects.filter((project) => !project.archived).map(({ id, name, icon }) => ({ id, name, icon })));
  listeners.forEach((listener) => listener());
}

export const subscribeProjects = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getProjectsSnapshot = () => snapshot;

/** Asks for the list (once: nothing happens while it is loading or loaded, or after a failure until `refreshProjects`). */
export function loadProjects(): void {
  if (snapshot.status === 'idle') void refreshProjects();
}

/** Asks again (the counters may have moved), keeping the list on screen meanwhile; a failure keeps it too. */
export function refreshProjects(): Promise<void> {
  if (inflight) return inflight;
  const mine = generation;
  if (snapshot.status !== 'ready') set({ status: 'loading', projects: snapshot.projects });
  const run = fetchProjects().then(
    (projects) => {
      if (mine === generation) set({ status: 'ready', projects });
    },
    () => {
      if (mine === generation) if (snapshot.status !== 'ready') set({ status: 'error', projects: [] });
    },
  );
  inflight = run.finally(() => {
    if (mine === generation) inflight = null;
  });
  return inflight;
}

const asError = (error: unknown): ApiError => (error instanceof ApiError ? error : new ApiError('network', 0, 'network'));

/** Creates a project and adds it to the list; resolves to the new one, or the error (status 409 is a name clash). */
export async function addProject(name: string, icon: string | null): Promise<LiveProject | ApiError> {
  try {
    const project = await createProject(name, icon);
    set({ status: 'ready', projects: [...snapshot.projects, project] });
    return project;
  } catch (error) {
    return asError(error);
  }
}

/** Renames, re-icons or archives a project in the list; resolves to null on success. */
export async function changeProject(id: string, patch: Partial<{ name: string; archived: boolean; icon: string | null }>): Promise<ApiError | null> {
  try {
    const project = await patchProject(id, patch);
    set({ status: snapshot.status, projects: snapshot.projects.map((existing) => (existing.id === id ? { ...existing, ...project } : existing)) });
    return null;
  } catch (error) {
    return asError(error);
  }
}

/** Forgets everything (tests; and a new page load starts empty anyway). */
export function resetProjects(): void {
  generation += 1;
  inflight = null;
  set(IDLE);
}
