import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  API_BASE,
  ApiError,
  createEvent,
  createTask,
  deleteTask,
  fetchBootstrap,
  fetchEvents,
  fetchSummary,
  fetchTasks,
  parseBootstrap,
  parseEvents,
  parseSummary,
  parseTask,
  parseTasks,
  patchTask,
  createProject,
  fetchProjects,
  parseProject,
  parseProjects,
  patchProject,
  scopeFromKey,
  scopeKey,
  scopePath,
} from './liveApi';
import { installFakeApi, projectTask, task } from '../../test/dashboardsApiMock';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const stub = (body: unknown, status = 200) =>
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))));

describe('the bootstrap call', () => {
  it('asks the same-origin URL once, with no Authorization header', async () => {
    const api = installFakeApi();
    const result = await fetchBootstrap();
    expect(result?.enabled).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].url).toBe(`${API_BASE}/bootstrap`);
    expect(Object.keys(api.calls[0].headers).map((h) => h.toLowerCase())).not.toContain('authorization');
  });

  it('reads the areas and the server time', () => {
    const parsed = parseBootstrap({
      enabled: true,
      spaces: [{ id: 'personal' }],
      areas: [{ id: 'money', space_id: 'personal', name_ru: 'Деньги', name_en: 'Money', sort: 0 }, { nope: 1 }],
      server_time: '2026-11-22T10:00:00+00:00',
    });
    expect(parsed).toEqual({ enabled: true, areas: [{ id: 'money', nameRu: 'Деньги', nameEn: 'Money' }], serverTime: '2026-11-22T10:00:00+00:00', spaceNames: {} });
  });

  it('keeps the names the server gives spaces, and only real renames', () => {
    const parsed = parseBootstrap({
      enabled: true,
      spaces: [
        { id: 'personal', name: 'Personal' },
        { id: 'work-1', name: '  Acme  ' },
        { id: 'work-2', name: 'Globex' },
        { id: 'work-3', name: 'Nope' },
      ],
    });
    expect(parsed?.spaceNames).toEqual({ 'work-1': 'Acme', 'work-2': 'Globex' });
  });

  it('ignores a space name that is blank, too long, not text, or the bundled English default', () => {
    const names = (spaces: unknown) => parseBootstrap({ enabled: true, spaces })?.spaceNames;
    expect(names([{ id: 'work-1', name: 'Work 1' }, { id: 'work-2', name: 'Work 2' }])).toEqual({});
    expect(names([{ id: 'work-1', name: '   ' }, { id: 'work-2', name: 'x'.repeat(25) }])).toEqual({});
    expect(names([{ id: 'work-1', name: 5 }, { id: 'work-2' }, 'work-1', null])).toEqual({});
    expect(names({ id: 'work-1', name: 'Acme' })).toEqual({});
    expect(names(undefined)).toEqual({});
    expect(names([{ id: 'work-1', name: 'x'.repeat(24) }])).toEqual({ 'work-1': 'x'.repeat(24) });
  });

  it('says disabled as it is', async () => {
    installFakeApi({ enabled: false });
    expect(await fetchBootstrap()).toEqual({ enabled: false, areas: [], serverTime: null, spaceNames: {} });
  });

  it('is null (the sample data) on a network error, a non-2xx answer, a non-JSON body or the wrong shape', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    expect(await fetchBootstrap()).toBeNull();
    stub({ error: 'x' }, 503);
    expect(await fetchBootstrap()).toBeNull();
    stub('<html>proxy error</html>');
    expect(await fetchBootstrap()).toBeNull();
    stub({ enabled: 'yes' });
    expect(await fetchBootstrap()).toBeNull();
    stub([]);
    expect(await fetchBootstrap()).toBeNull();
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))),
    );
    const pending = fetchBootstrap();
    await vi.advanceTimersByTimeAsync(8001);
    expect(await pending).toBeNull();
  });
});

describe('parsing', () => {
  it('reads a task, from the contract field names, and refuses a record of the wrong shape', () => {
    const raw = task('personal', 'Pay', { priority: true, due_date: '2026-11-25', area_id: 'money', notes: 'n' });
    expect(parseTask(raw)).toMatchObject({ space: 'personal', title: 'Pay', priority: true, dueDate: '2026-11-25', areaId: 'money', notes: 'n', status: 'open' });
    expect(parseTask({ ...raw, status: 'later' })).toBeNull();
    expect(parseTask({ ...raw, space_id: 'work-3' })).toBeNull();
    expect(parseTask({ ...raw, id: 5 })).toBeNull();
    expect(parseTask({ ...raw, due_date: 'tomorrow' })?.dueDate).toBeNull();
    expect(parseTask(null)).toBeNull();
  });

  it('reads a list as a bare array or inside an object, dropping bad records', () => {
    const good = task('work-1', 'A');
    expect(parseTasks([good, { junk: true }])).toHaveLength(1);
    expect(parseTasks({ tasks: [good] })).toHaveLength(1);
    expect(parseTasks({ items: [good] })).toHaveLength(1);
    expect(parseTasks({ other: [good] })).toBeNull();
    expect(parseTasks('x')).toBeNull();
    expect(parseEvents([{ id: 'e1', space_id: 'personal', title: 'T', starts_at: '2026-11-23T10:00:00Z', ends_at: '2026-11-23T11:00:00Z', busy_only: true }])).toEqual([
      { id: 'e1', space: 'personal', title: 'T', startsAt: '2026-11-23T10:00:00Z', endsAt: '2026-11-23T11:00:00Z', busyOnly: true },
    ]);
    expect(parseEvents([{ id: 'e1', space_id: 'personal', title: 'T', starts_at: 'later', ends_at: 'x' }])).toEqual([]);
  });

  it('reads the summary as a map under `spaces`, a bare map or a list, and needs all three spaces', () => {
    const one = { open: 3, priority: 1, overdue: 2, next_event: { title: 'Gym', starts_at: '2026-11-23T18:00:00Z' } };
    const map = { personal: one, 'work-1': { ...one, next_event: null }, 'work-2': { open: 0, priority: 0, overdue: 0, next_event: null } };
    for (const body of [{ spaces: map }, map, { spaces: Object.entries(map).map(([id, value]) => ({ id, ...value })) }]) {
      const summary = parseSummary(body)!;
      expect(summary.personal).toEqual({ open: 3, priority: 1, overdue: 2, next: { title: 'Gym', startsAt: '2026-11-23T18:00:00Z' } });
      expect(summary['work-1'].next).toBeNull();
    }
    expect(parseSummary({ spaces: { personal: one } })).toBeNull();
    expect(parseSummary(7)).toBeNull();
  });
});

describe('the data calls', () => {
  it('lists a space\'s tasks with a status', async () => {
    const api = installFakeApi();
    const tasks = await fetchTasks('personal', 'all');
    expect(tasks.length).toBeGreaterThan(3);
    expect(tasks.every((t) => t.space === 'personal')).toBe(true);
    expect(api.calls[0].url).toBe(`${API_BASE}/spaces/personal/tasks?status=all`);
  });

  it('creates, patches and deletes with snake_case bodies', async () => {
    const api = installFakeApi();
    const created = await createTask('personal', { title: 'New', areaId: 'money', priority: true, dueDate: '2026-12-01' });
    expect(api.calls[0]).toMatchObject({ method: 'POST', path: '/spaces/personal/tasks', body: { title: 'New', area_id: 'money', priority: true, due_date: '2026-12-01' } });
    expect(api.calls[0].headers['Content-Type']).toBe('application/json');
    await patchTask(created.id, { status: 'done', dueDate: null });
    expect(api.calls[1]).toMatchObject({ method: 'PATCH', path: `/tasks/${created.id}`, body: { status: 'done', due_date: null } });
    await deleteTask(created.id);
    expect(api.calls[2]).toMatchObject({ method: 'DELETE', path: `/tasks/${created.id}` });
    expect(api.tasks.some((t) => t.id === created.id)).toBe(false);
  });

  it('omits fields that were not given, and a plain create has just the title', async () => {
    const api = installFakeApi();
    await createTask('work-1', { title: 'Only' });
    expect(api.calls[0].body).toEqual({ title: 'Only' });
  });

  it('reads events for a range and creates one in a space', async () => {
    const api = installFakeApi();
    await fetchEvents('2026-11-23', '2026-11-29');
    expect(api.calls[0].url).toBe(`${API_BASE}/events?from=2026-11-23&to=2026-11-29`);
    const made = await createEvent('work-2', { title: 'Sync', startsAt: '2026-11-24T10:00:00+00:00', endsAt: '2026-11-24T11:00:00+00:00', busyOnly: true });
    expect(api.calls[1]).toMatchObject({ method: 'POST', path: '/spaces/work-2/events', body: { title: 'Sync', starts_at: '2026-11-24T10:00:00+00:00', ends_at: '2026-11-24T11:00:00+00:00', busy_only: true } });
    expect(made.space).toBe('work-2');
  });

  it('rejects with an ApiError carrying the status and the app error code', async () => {
    installFakeApi({ fail: ['summary'] });
    await expect(fetchSummary()).rejects.toMatchObject({ name: 'ApiError', status: 500, code: 'internal_error' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    await expect(fetchTasks('personal')).rejects.toMatchObject({ code: 'network', status: 0 });
    stub('<html>', 200);
    await expect(fetchTasks('personal')).rejects.toMatchObject({ code: 'bad_response' });
    stub({ nothing: 1 });
    await expect(fetchTasks('personal')).rejects.toBeInstanceOf(ApiError);
    stub('<html>down</html>', 502);
    await expect(fetchEvents('2026-11-23', '2026-11-29')).rejects.toMatchObject({ code: 'http', status: 502 });
  });
});

describe('projects', () => {
  it('reads the not-archived projects out of the bootstrap', () => {
    const parsed = parseBootstrap({ enabled: true, projects: [{ id: 'garden', name: 'Garden' }, { id: 5 }, { name: 'x' }] });
    expect(parsed?.projects).toEqual([{ id: 'garden', name: 'Garden' }]);
    expect(parseBootstrap({ enabled: true })?.projects).toEqual([]);
  });

  it('reads a project with its counters, and a list under `projects` or bare', () => {
    expect(parseProject({ id: 'garden', name: 'Garden', archived: true, open: 4, priority: 1, overdue: 2 })).toEqual({
      id: 'garden',
      name: 'Garden',
      archived: true,
      open: 4,
      priority: 1,
      overdue: 2,
    });
    expect(parseProject({ id: 'a', name: 'A' })).toEqual({ id: 'a', name: 'A', archived: false, open: 0, priority: 0, overdue: 0 });
    expect(parseProject({ id: 'a' })).toBeNull();
    expect(parseProjects({ projects: [{ id: 'a', name: 'A' }, { junk: 1 }] })).toHaveLength(1);
    expect(parseProjects([{ id: 'a', name: 'A' }])).toHaveLength(1);
    expect(parseProjects({ nope: [] })).toBeNull();
  });

  it('reads a project\'s task (project_id, no space_id) and still refuses a record with neither', () => {
    const parsed = parseTask(projectTask('garden', 'Buy seeds'));
    expect(parsed).toMatchObject({ projectId: 'garden', space: null, title: 'Buy seeds' });
    expect(parseTask(task('personal', 'A'))).toMatchObject({ projectId: null, space: 'personal' });
    const orphan = { ...task('personal', 'A') } as Record<string, unknown>;
    delete orphan.space_id;
    expect(parseTask(orphan)).toBeNull();
  });

  it('addresses a task list by a space or by a project, and a scope survives its key', () => {
    expect(scopePath('personal')).toBe('/spaces/personal');
    expect(scopePath({ project: 'garden' })).toBe('/projects/garden');
    expect(scopePath({ project: 'a b' })).toBe('/projects/a%20b');
    for (const scope of ['work-1', { project: 'garden' }] as const) expect(scopeFromKey(scopeKey(scope))).toEqual(scope);
    expect(scopeKey('personal')).toBe('space:personal');
    expect(scopeKey({ project: 'garden' })).toBe('project:garden');
  });

  it('reads, creates and writes a project\'s tasks under the project, and a space\'s tasks as before', async () => {
    const api = installFakeApi({ projects: [{ id: 'garden', name: 'Garden' }], tasks: [projectTask('garden', 'Seeds')] });
    const scope = { project: 'garden' };
    const listed = await fetchTasks(scope, 'all');
    expect(listed).toHaveLength(1);
    expect(api.calls[0].url).toBe(`${API_BASE}/projects/garden/tasks?status=all`);
    const created = await createTask(scope, { title: 'New', priority: true });
    expect(api.calls[1]).toMatchObject({ method: 'POST', path: '/projects/garden/tasks', body: { title: 'New', priority: true } });
    await patchTask(created.id, { status: 'done' }, undefined, scope);
    expect(api.calls[2]).toMatchObject({ method: 'PATCH', path: `/projects/garden/tasks/${created.id}`, body: { status: 'done' } });
    await deleteTask(created.id, undefined, scope);
    expect(api.calls[3]).toMatchObject({ method: 'DELETE', path: `/projects/garden/tasks/${created.id}` });
    // A space's task needs no scope.
    const other = await createTask('work-1', { title: 'Space task' });
    await patchTask(other.id, { priority: true });
    expect(api.calls[5].path).toBe(`/tasks/${other.id}`);
  });

  it('lists, creates and changes projects; a name clash is a 409', async () => {
    const api = installFakeApi({ projects: [{ id: 'garden', name: 'Garden' }] });
    expect((await fetchProjects()).map((p) => p.name)).toEqual(['Garden']);
    const made = await createProject('Side project');
    expect(made).toMatchObject({ id: 'side-project', name: 'Side project' });
    expect(api.calls[1]).toMatchObject({ method: 'POST', path: '/projects', body: { name: 'Side project' } });
    await patchProject('garden', { name: 'Allotment', archived: true });
    expect(api.calls[2]).toMatchObject({ method: 'PATCH', path: '/projects/garden', body: { name: 'Allotment', archived: true } });
    await expect(createProject('allotment')).rejects.toMatchObject({ status: 409, code: 'conflict' });
  });
});
