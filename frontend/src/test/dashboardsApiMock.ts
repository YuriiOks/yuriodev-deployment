import { vi } from 'vitest';
import { localDate } from '../services/dashboards/liveTime';

/*
 * An in-memory stand-in for the dashboards API (the contract's endpoints), installed as the global fetch. It records
 * every call, applies writes to its own lists so a re-read sees them, and can be told which requests to refuse.
 */

export type FailKey = 'bootstrap' | 'summary' | 'tasks' | 'events' | 'create' | 'patch' | 'delete' | 'createEvent';

export interface Call {
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly body: Record<string, unknown> | null;
  readonly headers: Record<string, string>;
}

export interface FakeApi {
  readonly calls: Call[];
  readonly tasks: Record<string, unknown>[];
  readonly events: Record<string, unknown>[];
  readonly fail: Set<FailKey>;
  /** While set, a PATCH waits for it: resolve it to let the request through (to look at the optimistic state first). */
  gate: Promise<void> | null;
  callsTo: (method: string, pathPart: string) => Call[];
}

export const BASE = '/api/dashboards/v1';

export const AREAS = [
  { id: 'money', space_id: 'personal', name_ru: 'Деньги', name_en: 'Money', sort: 0 },
  { id: 'health-sport', space_id: 'personal', name_ru: 'Здоровье и спорт', name_en: 'Health and sport', sort: 1 },
  { id: 'romantic', space_id: 'personal', name_ru: 'Романтические отношения', name_en: 'Romantic relationships', sort: 2 },
];

export const dayOffset = (n: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + n);
  return localDate(date);
};

let counter = 0;

export function task(space: string, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  counter += 1;
  return {
    id: `t${counter}`,
    space_id: space,
    title,
    notes: '',
    area_id: null,
    priority: false,
    due_date: null,
    status: 'open',
    done_at: null,
    source: 'web',
    created_at: new Date(Date.UTC(2026, 10, 1, 10, counter)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 10, 1, 10, counter)).toISOString(),
    ...extra,
  };
}

export function event(space: string, title: string, day: string, start: string, end: string, extra: Record<string, unknown> = {}) {
  counter += 1;
  return {
    id: `e${counter}`,
    space_id: space,
    title,
    starts_at: new Date(`${day}T${start}:00`).toISOString(),
    ends_at: new Date(`${day}T${end}:00`).toISOString(),
    busy_only: false,
    source: 'web',
    ...extra,
  };
}

/** The tasks the live tests start from (personal: one of every group, plus a done one; Work 1: one). */
export function sampleTasks(): Record<string, unknown>[] {
  return [
    task('personal', 'Pay the bill', { priority: true, due_date: dayOffset(-2), area_id: 'money' }),
    task('personal', 'Call the clinic', { due_date: dayOffset(0), area_id: 'health-sport' }),
    task('personal', 'Book a table', { due_date: dayOffset(3), area_id: 'romantic' }),
    task('personal', 'Collect the papers', { due_date: dayOffset(20) }),
    task('personal', 'Plan a trip'),
    task('personal', 'Old chore', { status: 'done', done_at: '2026-11-10T10:00:00Z', area_id: 'money' }),
    task('work-1', 'Review the pull request', { priority: true, due_date: dayOffset(0) }),
  ];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failure = (status = 500) => json({ error: 'internal_error', message: 'x', request_id: 'test' }, status);

export interface FakeApiOptions {
  readonly enabled?: boolean;
  readonly tasks?: Record<string, unknown>[];
  readonly events?: Record<string, unknown>[];
  readonly fail?: FailKey[];
  /** Names the server gives spaces (by id); the others get the English default. */
  readonly spaceNames?: Record<string, string>;
}

export function installFakeApi({ enabled = true, tasks = sampleTasks(), events = [], fail = [], spaceNames = {} }: FakeApiOptions = {}): FakeApi {
  const api: FakeApi = {
    calls: [],
    tasks,
    events,
    fail: new Set(fail),
    gate: null,
    callsTo: (method, pathPart) => api.calls.filter((call) => call.method === method && call.path.includes(pathPart)),
  };

  const handle = async (call: Call): Promise<Response> => {
    const { method, path, body } = call;
    const url = new URL(call.url, 'http://localhost');
    if (path === '/bootstrap') {
      if (api.fail.has('bootstrap')) return failure();
      return json(enabled ? { enabled: true, spaces: [{ id: 'personal', name: spaceNames.personal ?? 'Personal' }, { id: 'work-1', name: spaceNames['work-1'] ?? 'Work 1' }, { id: 'work-2', name: spaceNames['work-2'] ?? 'Work 2' }], areas: AREAS, server_time: new Date().toISOString() } : { enabled: false });
    }
    if (path === '/summary') {
      if (api.fail.has('summary')) return failure();
      const spaces: Record<string, unknown> = {};
      for (const id of ['personal', 'work-1', 'work-2']) {
        const open = api.tasks.filter((t) => t.space_id === id && t.status === 'open');
        spaces[id] = {
          open: open.length,
          priority: open.filter((t) => t.priority).length,
          overdue: open.filter((t) => typeof t.due_date === 'string' && t.due_date < dayOffset(0)).length,
          next_event: id === 'work-1' ? { title: 'Team stand-up', starts_at: new Date(Date.now() + 47 * 60000).toISOString() } : null,
        };
      }
      return json({ spaces });
    }
    let match = /^\/spaces\/([\w-]+)\/tasks$/.exec(path);
    if (match) {
      if (method === 'GET') {
        if (api.fail.has('tasks')) return failure();
        const status = url.searchParams.get('status') ?? 'open';
        return json(api.tasks.filter((t) => t.space_id === match![1] && (status === 'all' || t.status === status)));
      }
      if (api.fail.has('create')) return failure();
      const created = task(match[1], String(body?.title), {
        notes: body?.notes ?? '',
        area_id: body?.area_id ?? null,
        priority: body?.priority === true,
        due_date: body?.due_date ?? null,
      });
      api.tasks.push(created);
      return json(created, 201);
    }
    match = /^\/tasks\/([\w-]+)$/.exec(path);
    if (match) {
      const found = api.tasks.find((t) => t.id === match![1]);
      if (!found) return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
      if (method === 'PATCH') {
        if (api.gate) await api.gate;
        if (api.fail.has('patch')) return failure();
        Object.assign(found, body);
        if (body && 'status' in body) found.done_at = body.status === 'done' ? new Date().toISOString() : null;
        return json(found);
      }
      if (api.fail.has('delete')) return failure();
      api.tasks.splice(api.tasks.indexOf(found), 1);
      return new Response(null, { status: 204 });
    }
    if (path === '/events' && method === 'GET') {
      if (api.fail.has('events')) return failure();
      const from = url.searchParams.get('from') ?? '';
      const to = url.searchParams.get('to') ?? '';
      return json(api.events.filter((e) => String(e.starts_at).slice(0, 10) >= from && String(e.starts_at).slice(0, 10) <= to));
    }
    match = /^\/spaces\/([\w-]+)\/events$/.exec(path);
    if (match && method === 'POST') {
      if (api.fail.has('createEvent')) return failure();
      const created = { id: `e${++counter}`, space_id: match[1], busy_only: false, source: 'web', ...body };
      api.events.push(created);
      return json(created, 201);
    }
    return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
  };

  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace(BASE, '').split('?')[0];
    const call: Call = {
      method: init?.method ?? 'GET',
      url,
      path,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string> | undefined) ?? {})),
    };
    api.calls.push(call);
    return handle(call);
  });
  vi.stubGlobal('fetch', mock);
  return api;
}
