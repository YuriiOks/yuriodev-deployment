import { vi } from 'vitest';
import { localDate } from '../services/dashboards/liveTime';

/*
 * An in-memory stand-in for the dashboards API (the contract's endpoints), installed as the global fetch. It records
 * every call, applies writes to its own lists so a re-read sees them, and can be told which requests to refuse.
 */

export type FailKey = 'bootstrap' | 'summary' | 'tasks' | 'events' | 'create' | 'patch' | 'delete' | 'createEvent' | 'projects' | 'createProject' | 'patchProject' | 'financeAccounts' | 'financeSummary' | 'financeTransactions' | 'financeMore' | 'financeCategories' | 'financeProviders' | 'financeRecurring' | 'financeUpcoming' | 'financeAttention' | 'today' | 'recurringWrite' | 'recurringIssues' | 'attentionWrite' | 'manualWrite' | 'manualConnection' | 'manualAccount';

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
  /** The finance API's data (invented in the tests): accounts, bank links, transactions (newest first), the month's summary. */
  readonly finance: FinanceData;
  /** The projects; their tasks are in `tasks`, with a `project_id` and no `space_id`. */
  readonly projects: { id: string; name: string; archived: boolean; icon: string | null }[];
  readonly fail: Set<FailKey>;
  /** What GET /today answers, by scope (the page's Today view); a scope with none answers an unreadable body. */
  readonly today: Record<string, Record<string, unknown>>;
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

/** A task of a project: the space endpoints' shape with `project_id` instead of `space_id`. */
export function projectTask(project: string, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const rest = { ...task('', title, extra) };
  delete rest.space_id;
  return { ...rest, project_id: project };
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

export interface FinanceData {
  accounts: Record<string, unknown>[];
  connections: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  summary: Record<string, unknown>;
  /** GET /finance/categories (default: no spending). */
  categories?: Record<string, unknown>;
  /** The root `display` block of the accounts and transactions answers (default: none, as an older server). */
  display?: Record<string, unknown>;
  /** GET /finance/manual/currencies: the codes an account entered by hand may be in (default: none, answered 404 as an older server). */
  manualCurrencies?: string[];
  /** GET /finance/providers: the banks' logos (default: none). */
  providers?: Record<string, unknown>[];
  /** The logo bundle: `logos_version` on the providers answer and what GET /finance/providers/logos answers (default: neither, as an older server). */
  logosBundle?: { version: string; logos: Record<string, unknown> };
  /** The icon bundle: `icons_version` on the recurring and upcoming answers and what GET /finance/recurring/icons answers. */
  iconsBundle?: { version: string; icons: Record<string, unknown> };
  /** GET /finance/recurring (default: none). Writes change this list in place. */
  recurring?: Record<string, unknown>[];
  /** GET /finance/upcoming (default: nothing due). */
  upcoming?: Record<string, unknown>;
  /** GET /finance/attention items (default: none); snooze, dismiss and restore change their state in place. */
  attention?: Record<string, unknown>[];
  /** What POST /finance/manual/accounts/{id}/statement answers (its `dry_run` follows the query). Default: a clean file of three lines. */
  manualStatement?: { status: number; body: Record<string, unknown> };
}

export interface FakeApiOptions {
  readonly finance?: Partial<FinanceData>;
  /** What GET /today answers, by scope (the Today view of a space). */
  readonly today?: Record<string, Record<string, unknown>>;
  /** The server's next event per space, when a test needs other than the default (Work 1's stand-up). */
  readonly nextEvents?: Record<string, { title: string; starts_at: string } | null>;
  readonly enabled?: boolean;
  readonly tasks?: Record<string, unknown>[];
  readonly events?: Record<string, unknown>[];
  readonly projects?: { id: string; name: string; archived?: boolean; icon?: string | null }[];
  readonly fail?: FailKey[];
  /** Names the server gives spaces (by id); the others get the English default. */
  readonly spaceNames?: Record<string, string>;
  /** Icons (image data URIs) the server gives spaces, by id. */
  readonly spaceIcons?: Record<string, string>;
  /** `limits` of the bootstrap (default: none, as an older server). */
  readonly limits?: Record<string, Record<string, number>>;
}

export function installFakeApi({ today = {}, enabled = true, tasks = sampleTasks(), events = [], projects = [], fail = [], spaceNames = {}, spaceIcons = {}, finance = {}, nextEvents = {}, limits }: FakeApiOptions = {}): FakeApi {
  const api: FakeApi = {
    calls: [],
    tasks,
    events,
    finance: { accounts: [], connections: [], transactions: [], summary: { month: '2026-11', as_of: null, currencies: [] }, ...finance },
    projects: projects.map((p) => ({ archived: false, icon: null, ...p })),
    fail: new Set(fail),
    today,
    gate: null,
    callsTo: (method, pathPart) => api.calls.filter((call) => call.method === method && call.path.includes(pathPart)),
  };

  const projectCounts = (p: { id: string; name: string; archived: boolean; icon: string | null }) => {
    const open = api.tasks.filter((t) => t.project_id === p.id && t.status === 'open');
    return {
      ...p,
      open: open.length,
      priority: open.filter((t) => t.priority).length,
      overdue: open.filter((t) => typeof t.due_date === 'string' && t.due_date < dayOffset(0)).length,
    };
  };

  const handle = async (call: Call): Promise<Response> => {
    const { method, path, body } = call;
    const url = new URL(call.url, 'http://localhost');
    if (path === '/bootstrap') {
      if (api.fail.has('bootstrap')) return failure();
      return json(enabled ? { enabled: true, spaces: [{ id: 'personal', name: spaceNames.personal ?? 'Personal', icon: spaceIcons.personal ?? null }, { id: 'work-1', name: spaceNames['work-1'] ?? 'Work 1', icon: spaceIcons['work-1'] ?? null }, { id: 'work-2', name: spaceNames['work-2'] ?? 'Work 2', icon: spaceIcons['work-2'] ?? null }], areas: AREAS, projects: api.projects.filter((p) => !p.archived).map(({ id, name, icon }) => ({ id, name, icon })), server_time: new Date().toISOString(), ...(limits ? { limits } : {}) } : { enabled: false });
    }
    if (path === '/today') {
      if (api.fail.has('today')) return failure();
      return json(api.today[url.searchParams.get('scope') ?? ''] ?? {});
    }
    if (path === '/finance/accounts') {
      if (api.fail.has('financeAccounts')) return failure();
      return json({ accounts: api.finance.accounts, connections: api.finance.connections, ...(api.finance.display ? { display: api.finance.display } : {}) });
    }
    if (path === '/finance/recurring' || (path !== '/finance/recurring/icons' && /^\/finance\/recurring\/[\w-]+(\/paid|\/icon\/refresh|\/icon)?$/.test(path))) {
      const list = (api.finance.recurring ??= []);
      if (path === '/finance/recurring' && method === 'GET') {
        if (api.fail.has('financeRecurring')) return failure();
        const kind = url.searchParams.get('kind');
        return json({ ...(api.finance.iconsBundle ? { icons_version: api.finance.iconsBundle.version } : {}), recurring: list.filter((row) => !kind || row.kind === kind), display: api.finance.display ?? { currency: 'GBP', rates: {}, missing: [] } });
      }
      if (api.fail.has('recurringIssues')) return json({ error: 'validation_error', message: 'x', request_id: 'test', fields: ['amount'], issues: [{ field: 'amount', code: 'out_of_range', limit: 1, bound: 'min', type: 'greater_than', reason: 'x' }] }, 422);
      if (api.fail.has('recurringWrite')) return json({ error: 'validation_error', message: 'amount must be positive', request_id: 'test' }, 422);
      if (path === '/finance/recurring') {
        const created = { id: `r-new-${++counter}`, is_active: true, frequency_interval: 1, kind: 'service', frequency: 'monthly', converted: false, ...body };
        list.push(created);
        return json(created, 201);
      }
      const found = list.find((row) => row.id === path.split('/')[3]);
      if (!found) return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
      if (method === 'DELETE') {
        list.splice(list.indexOf(found), 1);
        return new Response(null, { status: 204 });
      }
      if (path.endsWith('/icon/refresh')) {
        found.icon_state = 'pending';
        found.icon_url = null;
        return json(found);
      }
      if (path.endsWith('/icon') && method === 'POST') {
        const kind = (call.headers['Content-Type'] ?? call.headers['content-type'] ?? '').split(';')[0];
        if (kind !== 'image/png' && kind !== 'image/svg+xml') return json({ error: 'unsupported_media_type', message: 'Send image/png or image/svg+xml', request_id: 'test' }, 415);
        found.icon_url = `/api/dashboards/v1/finance/recurring/${found.id}/icon?v=0a1b2c3d`;
        found.icon_state = 'ok';
        return json(found);
      }
      if (path.endsWith('/paid')) {
        // The date the page showed: when the payment has moved on since, nothing is done (409).
        if (typeof body?.due_date === 'string' && body.due_date !== found.next_payment_date) return json({ error: 'conflict', message: 'This payment has already moved on', request_id: 'test' }, 409);
        found.next_payment_date = '2026-12-23';
        return json(found);
      }
      Object.assign(found, body);
      return json(found);
    }
    if (path === '/finance/upcoming') {
      if (api.fail.has('financeUpcoming')) return failure();
      return json({ ...(api.finance.iconsBundle ? { icons_version: api.finance.iconsBundle.version } : {}), from_date: '2026-11-23', to_date: '2026-12-07', items: [], totals: [], display: { currency: 'GBP', rates: {}, missing: [], complete: true, total: 0 }, ...api.finance.upcoming });
    }
    if (path === '/finance/attention' && method === 'GET') {
      if (api.fail.has('financeAttention')) return failure();
      const all = api.finance.attention ?? [];
      const hidden = all.filter((item) => item.state !== 'active');
      const shown = url.searchParams.get('include_hidden') === 'true' ? all : all.filter((item) => item.state === 'active');
      return json({ items: shown, hidden: hidden.length, display: api.finance.display ?? { currency: 'GBP', rates: {}, missing: [] } });
    }
    if (path === '/finance/attention/bulk' && method === 'POST') {
      if (api.fail.has('attentionWrite')) return failure();
      const keys = Array.isArray(body?.keys) ? (body.keys as string[]) : [];
      const all = api.finance.attention ?? [];
      const found = all.filter((entry) => keys.includes(String(entry.key)));
      const action = String(body?.action);
      const accepted: string[] = [];
      if (action === 'accept') {
        for (const entry of found) {
          const payment = (api.finance.recurring ?? []).find((row) => row.id === entry.subject_id);
          if (entry.kind !== 'amount_changed' || !payment || typeof entry.amount !== 'number') continue;
          payment.amount = entry.amount;
          accepted.push(String(entry.key));
        }
        return json({ items: found, missing: keys.filter((key) => !found.some((entry) => entry.key === key)), accepted });
      }
      for (const entry of found) {
        entry.state = action === 'snooze' ? 'snoozed' : action === 'dismiss' ? 'dismissed' : 'active';
        entry.snoozed_until = action === 'snooze' ? '2026-12-01T00:00:00Z' : null;
      }
      return json({ items: found, missing: keys.filter((key) => !found.some((entry) => entry.key === key)), accepted });
    }
    const accountPatch = /^\/finance\/accounts\/([\w-]+)$/.exec(path);
    if (accountPatch && method === 'PATCH') {
      if (api.fail.has('attentionWrite')) return failure();
      const account = api.finance.accounts.find((row) => row.id === accountPatch[1]);
      if (!account) return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
      Object.assign(account, body);
      return json(account);
    }
    const attentionAction = /^\/finance\/attention\/(snooze|dismiss|restore)$/.exec(path);
    if (attentionAction && method === 'POST') {
      if (api.fail.has('attentionWrite')) return failure();
      const found = (api.finance.attention ?? []).find((item) => item.key === body?.key);
      if (!found) return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
      found.state = attentionAction[1] === 'snooze' ? 'snoozed' : attentionAction[1] === 'dismiss' ? 'dismissed' : 'active';
      found.snoozed_until = attentionAction[1] === 'snooze' ? '2026-12-01T00:00:00Z' : null;
      return json(found);
    }
    if (path === '/finance/manual/connections' && method === 'POST') {
      if (api.fail.has('manualConnection')) return json({ error: 'validation_error', message: 'that bank is already entered', request_id: 'test' }, 422);
      const link = { id: `conn-${++counter}`, provider: String(body?.provider), status: 'ok', status_changed_at: null, last_ok_at: '2026-11-24T12:00:00Z', manual: true, display_name: typeof body?.display_name === 'string' ? body.display_name : null };
      api.finance.connections.push(link);
      if (typeof body?.brand_bg === 'string') {
        (api.finance.providers ??= []).push({ id: link.provider, name: link.display_name ?? link.provider, entry: 'manual', colors: { background: body.brand_bg, foreground: body.brand_fg }, logo: { on_light: null, on_dark: null, mark: null } });
      }
      return json(link, 201);
    }
    if (path === '/finance/manual/currencies') {
      if (!api.finance.manualCurrencies) return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
      return json({ currencies: api.finance.manualCurrencies.map((code) => ({ code, exponent: 2 })) });
    }
    const connectionPatch = /^\/finance\/manual\/connections\/([\w-]+)$/.exec(path);
    if (connectionPatch && method === 'PATCH') {
      const link = api.finance.connections.find((row) => row.id === connectionPatch[1]);
      if (!link) return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
      if (typeof body?.display_name === 'string') link.display_name = body.display_name;
      const info = (api.finance.providers ?? []).find((row) => row.id === link.provider);
      if (info) {
        if (typeof body?.display_name === 'string') info.name = body.display_name;
        if (typeof body?.brand_bg === 'string') info.colors = { background: body.brand_bg, foreground: body.brand_fg };
      }
      return json(link);
    }
    if (path === '/finance/manual/accounts' && method === 'POST') {
      if (api.fail.has('manualAccount')) return json({ error: 'validation_error', message: 'a credit card needs credit_limit above 0', request_id: 'test' }, 422);
      const link = api.finance.connections.find((row) => row.id === body?.connection_id);
      if (!link) return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
      const card = body?.kind === 'credit_card';
      const balance = card ? (body?.credit_limit as number) - (body?.owed as number) : (body?.balance as number);
      const created = { id: `acc-${++counter}`, connection_id: link.id, provider: link.provider, type: card ? 'credit' : 'current', kind: body?.kind, name: body?.name, currency: body?.currency, balance, credit_limit: card ? body?.credit_limit : 0, own_balance_minor: card ? -(body?.owed as number) : balance, mask_last4: body?.mask_last4 ?? null, balance_at: '2026-11-24T12:00:00Z', history_from: null, archived: false };
      api.finance.accounts.push(created);
      return json(created, 201);
    }
    const manualCall = /^\/finance\/manual\/accounts\/([\w-]+)\/(balance|statement)$/.exec(path);
    if (manualCall && method === 'POST') {
      if (api.fail.has('manualWrite')) return failure();
      const account = api.finance.accounts.find((row) => row.id === manualCall[1]);
      if (!account) return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
      if (manualCall[2] === 'balance') {
        const asOf = typeof body?.as_of === 'string' ? `${body.as_of}T23:59:59Z` : '2026-11-24T12:00:00Z';
        const minor = typeof body?.owed === 'number' ? (account.credit_limit as number) - body.owed : (body?.balance as number);
        account.balance = minor;
        account.own_balance_minor = typeof body?.owed === 'number' ? -body.owed : minor;
        const link = api.finance.connections.find((row) => row.provider === account.provider);
        if (link) link.last_ok_at = asOf;
        return json(account);
      }
      const configured = api.finance.manualStatement ?? { status: 200, body: { layout: 'csv', parsed: 3, created: 3, duplicates: 0, first_date: '2026-10-01', last_date: '2026-10-31', money_in: 150000, money_out: 4550, balance_applied: false, errors: [] } };
      return json({ ...configured.body, dry_run: url.searchParams.get('dry_run') === 'true' }, configured.status);
    }
    if (path === '/finance/providers/logos') {
      if (!api.finance.logosBundle) return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
      return json(api.finance.logosBundle);
    }
    if (path === '/finance/providers') {
      if (api.fail.has('financeProviders')) return failure();
      return json({ providers: api.finance.providers ?? [], ...(api.finance.logosBundle ? { logos_version: api.finance.logosBundle.version } : {}) });
    }
    if (path === '/finance/recurring/icons') {
      if (!api.finance.iconsBundle) return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
      return json(api.finance.iconsBundle);
    }
    if (path === '/finance/categories') {
      if (api.fail.has('financeCategories')) return failure();
      return json(api.finance.categories ?? { month: '2026-11', previous_month: '2026-10', currencies: [] });
    }
    if (path === '/finance/summary') {
      if (api.fail.has('financeSummary')) return failure();
      return json(api.finance.summary);
    }
    const txPatch = /^\/finance\/transactions\/([\w-]+)$/.exec(path);
    if (txPatch && method === 'PATCH') {
      const found = api.finance.transactions.find((row) => row.id === txPatch[1]);
      if (!found) return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
      if (typeof body?.internal_transfer === 'boolean') {
        found.internal_transfer = body.internal_transfer;
        found.internal_transfer_by_owner = true;
      }
      if (body && 'category' in body) {
        found.category_overridden = body.category !== null;
        if (typeof body.category === 'string') found.category = body.category;
      }
      return json(found);
    }
    if (path === '/finance/transactions') {
      const cursor = url.searchParams.get('cursor');
      if (api.fail.has('financeTransactions') || (cursor && api.fail.has('financeMore'))) return failure();
      const account = url.searchParams.get('account');
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const limit = Number(url.searchParams.get('limit') ?? 25);
      const category = url.searchParams.get('category');
      const found = api.finance.transactions.filter(
        (item) => (!account || item.account_id === account) && (!category || item.category === category) && (!q || `${item.description} ${item.counterparty ?? ''}`.toLowerCase().includes(q)),
      );
      const start = cursor ? Number(cursor) : 0;
      const page = found.slice(start, start + limit);
      return json({ transactions: page, next_cursor: start + limit < found.length ? String(start + limit) : null, ...(api.finance.display ? { display: api.finance.display } : {}) });
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
          next_event: id in nextEvents ? nextEvents[id] : id === 'work-1' ? { title: 'Team stand-up', starts_at: new Date(Date.now() + 47 * 60000).toISOString() } : null,
        };
      }
      return json({ spaces });
    }
    if (path === '/projects') {
      if (method === 'GET') {
        if (api.fail.has('projects')) return failure();
        return json({ projects: api.projects.map((p) => projectCounts(p)) });
      }
      if (api.fail.has('createProject')) return failure();
      const name = String(body?.name ?? '').trim();
      if (api.projects.some((p) => p.name.toLowerCase() === name.toLowerCase())) return json({ error: 'conflict', message: 'x', request_id: 'test' }, 409);
      const created = { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `p${++counter}`, name, archived: false, icon: typeof body?.icon === 'string' ? String(body.icon) : null };
      api.projects.push(created);
      return json(projectCounts(created), 201);
    }
    let match = /^\/projects\/([\w-]+)$/.exec(path);
    if (match && method === 'PATCH') {
      const found = api.projects.find((p) => p.id === match![1]);
      if (!found) return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
      if (api.fail.has('patchProject')) return failure();
      Object.assign(found, body);
      return json(projectCounts(found));
    }
    match = /^\/projects\/([\w-]+)\/tasks(?:\/([\w-]+))?$/.exec(path);
    if (match) {
      const project = api.projects.find((p) => p.id === match![1]);
      if (!project) return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
      if (!match[2] && method === 'GET') {
        if (api.fail.has('tasks')) return failure();
        const status = url.searchParams.get('status') ?? 'open';
        return json(api.tasks.filter((t) => t.project_id === project.id && (status === 'all' || t.status === status)));
      }
      if (!match[2]) {
        if (api.fail.has('create')) return failure();
        const created = projectTask(project.id, String(body?.title), { notes: body?.notes ?? '', priority: body?.priority === true, due_date: body?.due_date ?? null });
        api.tasks.push(created);
        return json(created, 201);
      }
      const found = api.tasks.find((t) => t.id === match![2] && t.project_id === project.id);
      if (!found) return json({ error: 'not_found', message: 'x', request_id: 'test' }, 404);
      if (method === 'PATCH') {
        if (api.fail.has('patch')) return failure();
        Object.assign(found, body);
        if (body && 'status' in body) found.done_at = body.status === 'done' ? new Date().toISOString() : null;
        return json(found);
      }
      api.tasks.splice(api.tasks.indexOf(found), 1);
      return new Response(null, { status: 204 });
    }
    match = /^\/spaces\/([\w-]+)\/tasks$/.exec(path);
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
