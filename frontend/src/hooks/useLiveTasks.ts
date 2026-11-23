import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  createTask,
  deleteTask,
  fetchTasks,
  patchTask,
  scopeFromKey,
  scopeKey,
  type LiveTask,
  type TaskScope,
  type TaskDraft,
  type TaskPatch,
} from '../services/dashboards/liveApi';

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface LiveTasks {
  readonly status: LoadStatus;
  /** Every task of the space, open and done; empty until the first answer. */
  readonly tasks: readonly LiveTask[];
  /** Tasks completed during this visit: they stay where they were, struck through, until the next load. */
  readonly sticky: ReadonlySet<string>;
  /** Tasks whose last toggle failed and was rolled back. */
  readonly failed: ReadonlySet<string>;
  readonly reload: () => void;
  /** Resolves to null on success, or the error to show. */
  readonly create: (draft: TaskDraft) => Promise<ApiError | null>;
  /** Completes or reopens a task at once and rolls back, marking it in `failed`, if the request fails. */
  readonly toggle: (id: string) => void;
  readonly update: (id: string, patch: TaskPatch) => Promise<ApiError | null>;
  readonly remove: (id: string) => Promise<ApiError | null>;
  readonly dismissFailure: (id: string) => void;
}

interface Loaded {
  readonly key: string;
  readonly status: 'ready' | 'error';
  readonly tasks: readonly LiveTask[];
}

const EMPTY: ReadonlySet<string> = new Set();

const asError = (error: unknown): ApiError => (error instanceof ApiError ? error : new ApiError('network', 0, 'network'));

/**
 * One list of tasks from the API (a space's, or a project's: `scope`), with the writes the page needs. State is only set from a request's callback
 * (never synchronously in an effect): "loading" is "the answer on hand is for another space or another reload".
 */
export function useLiveTasks(scope: TaskScope): LiveTasks {
  const [token, setToken] = useState(0);
  // The scope as a string, so what the effects depend on is stable (an object scope is a new value every render).
  const scopeId = scopeKey(scope);
  const key = `${scopeId}:${token}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [sticky, setSticky] = useState<ReadonlySet<string>>(EMPTY);
  const [failed, setFailed] = useState<ReadonlySet<string>>(EMPTY);
  const pending = useRef(new Set<string>());
  const tasksRef = useRef<readonly LiveTask[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTasks(scopeFromKey(scopeId), 'all', controller.signal).then(
      (tasks) => {
        if (controller.signal.aborted) return;
        tasksRef.current = tasks;
        setSticky(EMPTY);
        setFailed(EMPTY);
        setLoaded({ key, status: 'ready', tasks });
      },
      () => {
        if (controller.signal.aborted) return;
        setLoaded({ key, status: 'error', tasks: [] });
      },
    );
    return () => controller.abort();
  }, [scopeId, key]);

  const apply = useCallback((change: (tasks: readonly LiveTask[]) => readonly LiveTask[]) => {
    tasksRef.current = change(tasksRef.current);
    setLoaded((previous) => (previous ? { ...previous, status: 'ready', tasks: tasksRef.current } : previous));
  }, []);

  const replace = useCallback(
    (task: LiveTask) => apply((tasks) => tasks.map((existing) => (existing.id === task.id ? task : existing))),
    [apply],
  );

  const create = useCallback(
    async (draft: TaskDraft) => {
      try {
        const task = await createTask(scopeFromKey(scopeId), draft);
        apply((tasks) => [...tasks, task]);
        return null;
      } catch (error) {
        return asError(error);
      }
    },
    [scopeId, apply],
  );

  const toggle = useCallback(
    (id: string) => {
      const before = tasksRef.current.find((task) => task.id === id);
      if (!before || pending.current.has(id)) return;
      pending.current.add(id);
      const status = before.status === 'open' ? 'done' : 'open';
      setFailed((previous) => {
        if (!previous.has(id)) return previous;
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      replace({ ...before, status, doneAt: status === 'done' ? new Date().toISOString() : null });
      if (status === 'done') setSticky((previous) => new Set(previous).add(id));
      patchTask(id, { status }, undefined, scopeFromKey(scopeId)).then(
        (task) => {
          pending.current.delete(id);
          replace(task);
        },
        () => {
          pending.current.delete(id);
          replace(before);
          if (status === 'done') {
            setSticky((previous) => {
              const next = new Set(previous);
              next.delete(id);
              return next;
            });
          }
          setFailed((previous) => new Set(previous).add(id));
        },
      );
    },
    [replace, scopeId],
  );

  const update = useCallback(
    async (id: string, patch: TaskPatch) => {
      try {
        replace(await patchTask(id, patch, undefined, scopeFromKey(scopeId)));
        return null;
      } catch (error) {
        return asError(error);
      }
    },
    [replace, scopeId],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteTask(id, undefined, scopeFromKey(scopeId));
        apply((tasks) => tasks.filter((task) => task.id !== id));
        return null;
      } catch (error) {
        return asError(error);
      }
    },
    [apply, scopeId],
  );

  const dismissFailure = useCallback((id: string) => {
    setFailed((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  }, []);

  const current = loaded && loaded.key === key ? loaded : null;
  return {
    status: current ? current.status : 'loading',
    tasks: current ? current.tasks : [],
    sticky,
    failed,
    reload: () => setToken((value) => value + 1),
    create,
    toggle,
    update,
    remove,
    dismissFailure,
  };
}
