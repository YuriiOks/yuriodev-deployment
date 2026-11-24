import { parseIconKey } from './projectIcons';
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
  /** Icons the server gives spaces: small image data URIs only (never a link), kept as the server sent them. */
  readonly spaceIcons: Readonly<Partial<Record<SpaceId, string>>>;
  /** The user's projects that are not archived (the server's names). */
  readonly projects: readonly LiveProjectRef[];
}

/** A project with its counters (GET /projects). */
export interface LiveProject {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
  readonly open: number;
  readonly priority: number;
  readonly overdue: number;
  /** The icon key the user picked (a-z, 0-9, "-"), or null: the tile then shows the name's letter. */
  readonly icon: string | null;
}

/** What a list of tasks belongs to: a space (by id), or a project. */
export type TaskScope = SpaceId | { readonly project: string };

export interface LiveProjectRef {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
}

export type TaskStatus = 'open' | 'done';

export interface LiveTask {
  readonly id: string;
  /** The space it belongs to; null for a project's task. */
  readonly space: SpaceId | null;
  /** The project it belongs to; null for a space's task. */
  readonly projectId: string | null;
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
  /** Where a collected task stands at its source: a Linear state type, or GitHub's 'mine' / 'review' / 'reviewed'. */
  readonly stage: string | null;
  /** A Linear issue's own priority (urgent and high get a mark on the row); null for any other task. */
  readonly sourcePriority: SourcePriority | null;
  /** When the task last changed at its source. */
  readonly sourceUpdatedAt: string | null;
  /** A draft pull request. */
  readonly draft: boolean;
}

export type SourcePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

const SOURCE_PRIORITIES: readonly SourcePriority[] = ['urgent', 'high', 'medium', 'low', 'none'];

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

/** The only data URIs an icon may be (the server checks the same list), and the longest one. */
export const ICON_PREFIXES = [
  'data:image/png;base64,',
  'data:image/svg+xml;base64,',
  'data:image/x-icon;base64,',
  'data:image/vnd.microsoft.icon;base64,',
  'data:image/webp;base64,',
] as const;
export const MAX_ICON_LENGTH = 48 * 1024;

export function isIconUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_ICON_LENGTH) return false;
  const prefix = ICON_PREFIXES.find((candidate) => value.startsWith(candidate));
  if (!prefix) return false;
  const payload = value.slice(prefix.length);
  return payload.length > 0 && payload.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(payload);
}

function parseSpaceIcons(raw: unknown): Partial<Record<SpaceId, string>> {
  const icons: Partial<Record<SpaceId, string>> = {};
  if (!Array.isArray(raw)) return icons;
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const id = entry.id;
    if (isSpace(id) && isIconUri(entry.icon)) icons[id] = entry.icon;
  }
  return icons;
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
  const projects: LiveProjectRef[] = [];
  if (Array.isArray(body.projects)) {
    for (const raw of body.projects) {
      if (isObject(raw) && typeof raw.id === 'string' && typeof raw.name === 'string') projects.push({ id: raw.id, name: raw.name, icon: parseIconKey(raw.icon) });
    }
  }
  return { enabled: body.enabled, areas, serverTime: isDateTime(body.server_time) ? body.server_time : null, spaceNames: parseSpaceNames(body.spaces), spaceIcons: parseSpaceIcons(body.spaces), projects };
}

export function parseTask(raw: unknown): LiveTask | null {
  if (!isObject(raw)) return null;
  const space = raw.space_id ?? raw.space;
  const projectId = typeof raw.project_id === 'string' && raw.project_id !== '' ? raw.project_id : null;
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string') return null;
  if (!isSpace(space) && projectId === null) return null;
  if (raw.status !== 'open' && raw.status !== 'done') return null;
  return {
    id: raw.id,
    space: isSpace(space) ? space : null,
    projectId,
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
    sourcePriority: SOURCE_PRIORITIES.find((candidate) => candidate === raw.source_priority) ?? null,
    sourceUpdatedAt: isDateTime(raw.source_updated_at) ? raw.source_updated_at : null,
    draft: raw.draft === true,
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
export async function request(path: string, { method = 'GET', body, signal, timeoutMs = API_TIMEOUT_MS }: RequestOptions = {}): Promise<unknown> {
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

export function parseProject(raw: unknown): LiveProject | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  return { id: raw.id, name: raw.name, archived: raw.archived === true, open: asCount(raw.open), priority: asCount(raw.priority), overdue: asCount(raw.overdue), icon: parseIconKey(raw.icon) };
}

export function parseProjects(body: unknown): LiveProject[] | null {
  const list = listOf(body, ['projects', 'items']);
  if (!list) return null;
  return list.flatMap((raw) => {
    const project = parseProject(raw);
    return project ? [project] : [];
  });
}

/** The start of a task list's URL: `/spaces/{id}` or `/projects/{id}`. */
export function scopePath(scope: TaskScope): string {
  return typeof scope === 'string' ? `/spaces/${scope}` : `/projects/${encodeURIComponent(scope.project)}`;
}

/** A scope as a string key (and back): `space:personal`, `project:garden`. */
export function scopeKey(scope: TaskScope): string {
  return typeof scope === 'string' ? `space:${scope}` : `project:${scope.project}`;
}

export function scopeFromKey(key: string): TaskScope {
  return key.startsWith('project:') ? { project: key.slice('project:'.length) } : (key.slice('space:'.length) as SpaceId);
}

/** One task's URL: a space's tasks are addressed by id alone, a project's under the project. */
function taskPath(id: string, scope?: TaskScope): string {
  const own = encodeURIComponent(id);
  return scope !== undefined && typeof scope !== 'string' ? `${scopePath(scope)}/tasks/${own}` : `/tasks/${own}`;
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

export async function fetchTasks(scope: TaskScope, status: 'open' | 'done' | 'all' = 'all', signal?: AbortSignal): Promise<LiveTask[]> {
  return must(parseTasks(await request(`${scopePath(scope)}/tasks?status=${status}`, { signal })));
}

const taskBody = (draft: TaskDraft | TaskPatch): Json => {
  const body: Json = {};
  const source = draft as Record<string, unknown>;
  const names: Record<string, string> = { areaId: 'area_id', dueDate: 'due_date' };
  for (const [key, value] of Object.entries(source)) if (value !== undefined) body[names[key] ?? key] = value;
  return body;
};

export async function createTask(scope: TaskScope, draft: TaskDraft, signal?: AbortSignal): Promise<LiveTask> {
  return must(parseTask(await request(`${scopePath(scope)}/tasks`, { method: 'POST', body: taskBody(draft), signal })));
}

/** `scope` is only needed for a project's task (a space's tasks are addressed by id alone). */
export async function patchTask(id: string, patch: TaskPatch, signal?: AbortSignal, scope?: TaskScope): Promise<LiveTask> {
  return must(parseTask(await request(taskPath(id, scope), { method: 'PATCH', body: taskBody(patch), signal })));
}

export async function deleteTask(id: string, signal?: AbortSignal, scope?: TaskScope): Promise<void> {
  await request(taskPath(id, scope), { method: 'DELETE', signal });
}

/** The events of every space intersecting `from`..`to` (dates, at most 62 days apart). */
export async function fetchEvents(from: string, to: string, signal?: AbortSignal): Promise<LiveEvent[]> {
  return must(parseEvents(await request(`/events?from=${from}&to=${to}`, { signal })));
}

export async function createEvent(space: SpaceId, draft: EventDraft, signal?: AbortSignal): Promise<LiveEvent> {
  const body = { title: draft.title, starts_at: draft.startsAt, ends_at: draft.endsAt, busy_only: draft.busyOnly === true };
  return must(parseEvent(await request(`/spaces/${space}/events`, { method: 'POST', body, signal })));
}

export async function fetchProjects(signal?: AbortSignal): Promise<LiveProject[]> {
  return must(parseProjects(await request('/projects', { signal })));
}

/** Creates a project; the server makes its id. Rejects with status 409 when the name clashes. */
export async function createProject(name: string, icon?: string | null, signal?: AbortSignal): Promise<LiveProject> {
  const body = icon ? { name, icon } : { name };
  return must(parseProject(await request('/projects', { method: 'POST', body, signal })));
}

export async function patchProject(id: string, patch: Partial<{ name: string; archived: boolean; icon: string | null }>, signal?: AbortSignal): Promise<LiveProject> {
  return must(parseProject(await request(`/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, signal })));
}
