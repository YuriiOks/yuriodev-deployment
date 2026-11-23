import { SPACE_NAME } from './spaces';
import type { SpaceId } from './types';

/**
 * The client of the dashboards' data API (contract: version 1, prefix /api/dashboards/v1). Same origin: the proxy
 * routes /api/ to the backend in every environment, and on dev its basic auth is already satisfied by the browser,
 * so no header is sent. There is no build-time config.
 *
 * The bootstrap call never throws (a network error, a non-2xx answer or a non-JSON body all come back as null,
 * which means "use the bundled sample data"). Every other call rejects with an ApiError the page can show, and each
 * answer is checked on arrival: a record of the wrong shape is dropped, never half-used. The parsers read both the
 * contract's snake_case names and, where the contract leaves the envelope open, a bare list or an object holding it.
 */

export const API_BASE = '/api/dashboards/v1';

/** Give up on a request after this long. */
export const API_TIMEOUT_MS = 8000;

export type ApiErrorCode = 'network' | 'timeout' | 'bad_response' | 'http';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;

  constructor(code: ApiErrorCode | string, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface LiveArea {
  readonly id: string;
  readonly nameRu: string;
  readonly nameEn: string;
}

export interface Bootstrap {
  readonly enabled: boolean;
  readonly areas: readonly LiveArea[];
  readonly serverTime: string | null;
  /** Names the server gives spaces (only those that differ from the bundled English default). */
  readonly spaceNames: Readonly<Partial<Record<SpaceId, string>>>;
}

export type TaskStatus = 'open' | 'done';

export interface LiveTask {
  readonly id: string;
  readonly space: SpaceId;
  readonly title: string;
  readonly notes: string;
  readonly areaId: string | null;
  readonly priority: boolean;
  /** "YYYY-MM-DD" or null. */
  readonly dueDate: string | null;
  readonly status: TaskStatus;
  readonly doneAt: string | null;
  readonly createdAt: string;
  /** Who wrote it: 'manual', or a collector ('github', 'linear'). */
  readonly source: string;
  /** The task's page at its source (the pull request, the issue), when it has one. */
  readonly url: string | null;
  /** Where a collected task stands at its source: a Linear state type, or GitHub's 'mine' / 'review'. */
  readonly stage: string | null;
}

export interface TaskDraft {
  readonly title: string;
  readonly notes?: string;
  readonly areaId?: string | null;
  readonly priority?: boolean;
  readonly dueDate?: string | null;
}

export type TaskPatch = Partial<{
  title: string;
  notes: string;
  areaId: string | null;
  priority: boolean;
  dueDate: string | null;
  status: TaskStatus;
}>;

export interface LiveEvent {
  readonly id: string;
  readonly space: SpaceId;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  /** Shown in the other spaces as "Focus time", without details. */
  readonly busyOnly: boolean;
}

export interface SummaryNext {
  readonly title: string;
  readonly startsAt: string;
}

export interface SpaceSummaryLive {
  readonly open: number;
  readonly priority: number;
  readonly overdue: number;
  readonly next: SummaryNext | null;
}

export type LiveSummary = Readonly<Record<SpaceId, SpaceSummaryLive>>;

export interface EventDraft {
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly busyOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const SPACE_IDS: readonly SpaceId[] = ['personal', 'work-1', 'work-2'];

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isDateTime = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isSpace = (value: unknown): value is SpaceId => SPACE_IDS.includes(value as SpaceId);
const asCount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

/** The records of a list answer: a bare array, or an object holding the array under one of `keys`. */
function listOf(body: unknown, keys: readonly string[]): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (isObject(body)) {
    for (const key of keys) if (Array.isArray(body[key])) return body[key] as unknown[];
  }
  return null;
}

const MAX_SPACE_NAME = 24;

/** The names the server gives spaces. A name equal to the bundled English one is no rename: the page then keeps its bilingual name. */
function parseSpaceNames(raw: unknown): Partial<Record<SpaceId, string>> {
  const names: Partial<Record<SpaceId, string>> = {};
  if (!Array.isArray(raw)) return names;
  for (const entry of raw) {
    if (!isObject(entry) || typeof entry.name !== 'string') continue;
    const id = entry.id;
    if (!isSpace(id)) continue;
    const name = entry.name.trim();
    if (name.length === 0 || name.length > MAX_SPACE_NAME || name === SPACE_NAME[id].en) continue;
    names[id] = name;
  }
  return names;
}

export function parseBootstrap(body: unknown): Bootstrap | null {
  if (!isObject(body) || typeof body.enabled !== 'boolean') return null;
  const areas: LiveArea[] = [];
  if (Array.isArray(body.areas)) {
    for (const raw of body.areas) {
      if (!isObject(raw) || typeof raw.id !== 'string') continue;
      const nameEn = typeof raw.name_en === 'string' ? raw.name_en : typeof raw.name === 'string' ? raw.name : raw.id;
      const nameRu = typeof raw.name_ru === 'string' ? raw.name_ru : nameEn;
      areas.push({ id: raw.id, nameRu, nameEn });
    }
  }
  return { enabled: body.enabled, areas, serverTime: isDateTime(body.server_time) ? body.server_time : null, spaceNames: parseSpaceNames(body.spaces) };
}

export function parseTask(raw: unknown): LiveTask | null {
  if (!isObject(raw)) return null;
  const space = raw.space_id ?? raw.space;
  if (typeof raw.id !== 'string' || !isSpace(space) || typeof raw.title !== 'string') return null;
  if (raw.status !== 'open' && raw.status !== 'done') return null;
  return {
    id: raw.id,
    space,
    title: raw.title,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    areaId: typeof raw.area_id === 'string' ? raw.area_id : null,
    priority: raw.priority === true,
    dueDate: isDay(raw.due_date) ? raw.due_date : null,
    status: raw.status,
    doneAt: isDateTime(raw.done_at) ? raw.done_at : null,
    createdAt: isDateTime(raw.created_at) ? raw.created_at : '',
    source: typeof raw.source === 'string' ? raw.source : 'manual',
    url: typeof raw.url === 'string' && raw.url.startsWith('https://') ? raw.url : null,
    stage: typeof raw.stage === 'string' ? raw.stage : null,
  };
}

export function parseTasks(body: unknown): LiveTask[] | null {
  const list = listOf(body, ['tasks', 'items']);
  if (!list) return null;
  return list.flatMap((raw) => {
    const task = parseTask(raw);
    return task ? [task] : [];
  });
}

export function parseEvent(raw: unknown): LiveEvent | null {
  if (!isObject(raw)) return null;
  const space = raw.space_id ?? raw.space;
  if (typeof raw.id !== 'string' || !isSpace(space) || typeof raw.title !== 'string') return null;
  if (!isDateTime(raw.starts_at) || !isDateTime(raw.ends_at)) return null;
  return { id: raw.id, space, title: raw.title, startsAt: raw.starts_at, endsAt: raw.ends_at, busyOnly: raw.busy_only === true };
}

export function parseEvents(body: unknown): LiveEvent[] | null {
  const list = listOf(body, ['events', 'items']);
  if (!list) return null;
  return list.flatMap((raw) => {
    const event = parseEvent(raw);
    return event ? [event] : [];
  });
}

function parseSpaceSummary(raw: unknown): SpaceSummaryLive | null {
  if (!isObject(raw)) return null;
  const next = isObject(raw.next_event) && typeof raw.next_event.title === 'string' && isDateTime(raw.next_event.starts_at)
    ? { title: raw.next_event.title, startsAt: raw.next_event.starts_at }
    : null;
  return { open: asCount(raw.open), priority: asCount(raw.priority), overdue: asCount(raw.overdue), next };
}

/** The summary as one record per space: the contract names the fields, not the envelope, so a list, a map or `spaces` is read. */
export function parseSummary(body: unknown): LiveSummary | null {
  const source = isObject(body) && (Array.isArray(body.spaces) || isObject(body.spaces)) ? body.spaces : body;
  const bySpace = new Map<SpaceId, SpaceSummaryLive>();
  if (Array.isArray(source)) {
    for (const raw of source) {
      const id = isObject(raw) ? (raw.id ?? raw.space ?? raw.space_id) : null;
      const parsed = parseSpaceSummary(raw);
      if (isSpace(id) && parsed) bySpace.set(id, parsed);
    }
  } else if (isObject(source)) {
    for (const id of SPACE_IDS) {
      const parsed = parseSpaceSummary(source[id]);
      if (parsed) bySpace.set(id, parsed);
    }
  }
  if (!SPACE_IDS.every((id) => bySpace.has(id))) return null;
  return Object.fromEntries(SPACE_IDS.map((id) => [id, bySpace.get(id)!])) as LiveSummary;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** One JSON request: resolves with the parsed body (null for 204), rejects with an ApiError. */
async function request(path: string, { method = 'GET', body, signal, timeoutMs = API_TIMEOUT_MS }: RequestOptions = {}): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new ApiError('network', 0, 'aborted');
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw timedOut ? new ApiError('timeout', 0, 'timeout') : new ApiError('network', 0, 'network');
    }
    if (!response.ok) {
      let code = 'http';
      let message = `HTTP ${response.status}`;
      try {
        const error: unknown = await response.json();
        if (isObject(error)) {
          if (typeof error.error === 'string') code = error.error;
          if (typeof error.message === 'string') message = error.message;
        }
      } catch {
        // An error page that is not JSON: keep the generic code.
      }
      throw new ApiError(code, response.status, message);
    }
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new ApiError('bad_response', response.status, 'not JSON');
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

const must = <T>(value: T | null): T => {
  if (value === null) throw new ApiError('bad_response', 200, 'unexpected shape');
  return value;
};

/** Asks whether the dashboards run on real data. Never rejects: any failure is null, and null means the sample data. */
export async function fetchBootstrap(signal?: AbortSignal): Promise<Bootstrap | null> {
  try {
    return parseBootstrap(await request('/bootstrap', { signal }));
  } catch {
    return null;
  }
}

export async function fetchSummary(signal?: AbortSignal): Promise<LiveSummary> {
  return must(parseSummary(await request('/summary', { signal })));
}

export async function fetchTasks(space: SpaceId, status: 'open' | 'done' | 'all' = 'all', signal?: AbortSignal): Promise<LiveTask[]> {
  return must(parseTasks(await request(`/spaces/${space}/tasks?status=${status}`, { signal })));
}

const taskBody = (draft: TaskDraft | TaskPatch): Json => {
  const body: Json = {};
  const source = draft as Record<string, unknown>;
  const names: Record<string, string> = { areaId: 'area_id', dueDate: 'due_date' };
  for (const [key, value] of Object.entries(source)) if (value !== undefined) body[names[key] ?? key] = value;
  return body;
};

export async function createTask(space: SpaceId, draft: TaskDraft, signal?: AbortSignal): Promise<LiveTask> {
  return must(parseTask(await request(`/spaces/${space}/tasks`, { method: 'POST', body: taskBody(draft), signal })));
}

export async function patchTask(id: string, patch: TaskPatch, signal?: AbortSignal): Promise<LiveTask> {
  return must(parseTask(await request(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: taskBody(patch), signal })));
}

export async function deleteTask(id: string, signal?: AbortSignal): Promise<void> {
  await request(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE', signal });
}

/** The events of every space intersecting `from`..`to` (dates, at most 62 days apart). */
export async function fetchEvents(from: string, to: string, signal?: AbortSignal): Promise<LiveEvent[]> {
  return must(parseEvents(await request(`/events?from=${from}&to=${to}`, { signal })));
}

export async function createEvent(space: SpaceId, draft: EventDraft, signal?: AbortSignal): Promise<LiveEvent> {
  const body = { title: draft.title, starts_at: draft.startsAt, ends_at: draft.endsAt, busy_only: draft.busyOnly === true };
  return must(parseEvent(await request(`/spaces/${space}/events`, { method: 'POST', body, signal })));
}
