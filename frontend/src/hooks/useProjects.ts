import { useCallback, useEffect, useState } from 'react';
import { ApiError, createProject, fetchProjects, patchProject, type LiveProject } from '../services/dashboards/liveApi';

export interface Projects {
  readonly status: 'loading' | 'ready' | 'error';
  /** Every project the server lists, archived ones included (the hub shows only the others). */
  readonly projects: readonly LiveProject[];
  readonly reload: () => void;
  /** Creates a project; resolves to the new one, or the error (status 409 is a name clash). */
  readonly create: (name: string) => Promise<LiveProject | ApiError>;
  /** Renames or archives a project; resolves to null on success. */
  readonly update: (id: string, patch: Partial<{ name: string; archived: boolean }>) => Promise<ApiError | null>;
}

interface Loaded {
  readonly token: number;
  readonly ok: boolean;
  readonly projects: readonly LiveProject[];
}

const asError = (error: unknown): ApiError => (error instanceof ApiError ? error : new ApiError('network', 0, 'network'));

/** The user's projects (GET /projects), asked for on mount and on `reload`, with the two writes the pages need. */
export function useProjects(): Projects {
  const [token, setToken] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchProjects(controller.signal).then(
      (projects) => {
        if (!controller.signal.aborted) setLoaded({ token, ok: true, projects });
      },
      () => {
        if (!controller.signal.aborted) setLoaded({ token, ok: false, projects: [] });
      },
    );
    return () => controller.abort();
  }, [token]);

  const create = useCallback(async (name: string) => {
    try {
      const project = await createProject(name);
      setLoaded((previous) => (previous ? { ...previous, ok: true, projects: [...previous.projects, project] } : previous));
      return project;
    } catch (error) {
      return asError(error);
    }
  }, []);

  const update = useCallback(async (id: string, patch: Partial<{ name: string; archived: boolean }>) => {
    try {
      const project = await patchProject(id, patch);
      setLoaded((previous) =>
        previous ? { ...previous, projects: previous.projects.map((existing) => (existing.id === id ? { ...existing, ...project } : existing)) } : previous,
      );
      return null;
    } catch (error) {
      return asError(error);
    }
  }, []);

  const current = loaded && loaded.token === token ? loaded : null;
  return {
    status: current ? (current.ok ? 'ready' : 'error') : 'loading',
    projects: current ? current.projects : [],
    reload: () => setToken((value) => value + 1),
    create,
    update,
  };
}
