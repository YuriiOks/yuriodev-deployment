import { isObject } from './financeApi';
import { request } from './liveApi';

/** The pages that have a Today view served by the API (`GET /today?scope=`). */
export type TodayScope = 'personal' | 'work-1' | 'work-2' | 'money';

/** What the server says about something, as codes and facts (never a sentence): the page words them. */
export type Facts = Readonly<Record<string, unknown>>;

export interface TodaySubject {
  readonly type: string;
  readonly id: string | null;
  /** The owner's own text (a title, a bank's name): data, not a sentence. */
  readonly name: string | null;
}

export interface TodayQueueEntry {
  readonly key: string;
  readonly kind: string;
  readonly subject: TodaySubject;
  readonly facts: Facts;
  /** An action code the page words and wires (mark_done, open_external, snooze, open_task, ...). */
  readonly primary: string;
  readonly secondary: string | null;
  readonly link: { readonly kind: string; readonly id: string | null; readonly url: string | null };
}

export interface TodaySoonEntry {
  readonly key: string;
  readonly kind: string;
  readonly subject: TodaySubject;
  readonly facts: Facts;
}

export interface TodayStatEntry {
  readonly code: string;
  readonly value: number | null;
  readonly compare: { readonly code: string; readonly value: number | null } | null;
  readonly facts: Facts;
}

export interface TodayRowEntry {
  readonly key: string;
  readonly value: number;
  /** A name the server holds in two languages (a life area); else the page words `key`. */
  readonly label: { readonly ru: string; readonly en: string } | null;
  readonly facts: Facts;
}

export interface TodayInsight {
  readonly code: string;
  readonly facts: Facts;
}

export interface TodayEvent {
  readonly kind: string;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly subject: TodaySubject;
  readonly facts: Facts;
}

export type StreakState = 'cleared' | 'open' | 'future' | 'no_data';

export interface TodayStreak {
  readonly days: readonly { readonly date: string; readonly state: StreakState }[];
  readonly count: number;
}

export interface TodayData {
  readonly scope: TodayScope;
  readonly date: string;
  readonly summary: { readonly code: string; readonly facts: Facts };
  readonly queue: readonly TodayQueueEntry[];
  readonly queueTotal: number;
  readonly soon: readonly TodaySoonEntry[];
  readonly stats: readonly TodayStatEntry[];
  readonly breakdown: { readonly code: string; readonly rows: readonly TodayRowEntry[]; readonly insight: TodayInsight | null };
  readonly today: readonly TodayEvent[];
  /** The seven days of this week (Monday to Sunday) and the run of cleared days; null from an older server. */
  readonly streak: TodayStreak | null;
  /** The server says the assistant exists for this page (the page shows an Ask card only then, and never on Work 2). */
  readonly assistantEnabled: boolean;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const int = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null);
const facts = (value: unknown): Facts => (isObject(value) ? value : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function subject(value: unknown): TodaySubject {
  const raw = isObject(value) ? value : {};
  return { type: str(raw.type) ?? '', id: str(raw.id), name: str(raw.name) };
}

const STATES: readonly StreakState[] = ['cleared', 'open', 'future', 'no_data'];

function parseStreak(value: unknown): TodayStreak | null {
  if (!isObject(value) || !Array.isArray(value.days)) return null;
  const days = value.days.flatMap((raw) => {
    if (!isObject(raw)) return [];
    const date = str(raw.date);
    const state = STATES.find((candidate) => candidate === raw.state);
    return date && state ? [{ date, state }] : [];
  });
  return days.length === 0 ? null : { days, count: int(value.count) ?? 0 };
}

const SCOPES: readonly TodayScope[] = ['personal', 'work-1', 'work-2', 'money'];

/** Keeps what the page can use; an answer without its scope or summary is not one. */
export function parseToday(body: unknown): TodayData | null {
  if (!isObject(body)) return null;
  const scope = SCOPES.find((candidate) => candidate === body.scope);
  const summary = isObject(body.summary) ? body.summary : null;
  const breakdown = isObject(body.breakdown) ? body.breakdown : null;
  if (!scope || !summary || !str(summary.code) || !breakdown) return null;
  return {
    scope,
    date: str(body.date) ?? '',
    summary: { code: str(summary.code) ?? '', facts: facts(summary.facts) },
    queue: list(body.queue).flatMap((raw): TodayQueueEntry[] => {
      if (!isObject(raw)) return [];
      const key = str(raw.key);
      const primary = str(raw.primary);
      if (!key || !primary) return [];
      const link = isObject(raw.link) ? raw.link : {};
      return [{ key, kind: str(raw.kind) ?? '', subject: subject(raw.subject), facts: facts(raw.facts), primary, secondary: str(raw.secondary), link: { kind: str(link.kind) ?? '', id: str(link.id), url: str(link.url) } }];
    }),
    queueTotal: int(body.queue_total) ?? 0,
    soon: list(body.soon).flatMap((raw): TodaySoonEntry[] => {
      if (!isObject(raw)) return [];
      const key = str(raw.key);
      return key ? [{ key, kind: str(raw.kind) ?? '', subject: subject(raw.subject), facts: facts(raw.facts) }] : [];
    }),
    stats: list(body.stats).flatMap((raw): TodayStatEntry[] => {
      if (!isObject(raw)) return [];
      const code = str(raw.code);
      if (!code) return [];
      const compare = isObject(raw.compare) && str(raw.compare.code) ? { code: str(raw.compare.code) ?? '', value: int(raw.compare.value) } : null;
      return [{ code, value: int(raw.value), compare, facts: facts(raw.facts) }];
    }),
    breakdown: {
      code: str(breakdown.code) ?? '',
      rows: list(breakdown.rows).flatMap((raw): TodayRowEntry[] => {
        if (!isObject(raw)) return [];
        const key = str(raw.key);
        const value = int(raw.value);
        if (!key || value === null) return [];
        const label = isObject(raw.label) && str(raw.label.ru) && str(raw.label.en) ? { ru: str(raw.label.ru) ?? '', en: str(raw.label.en) ?? '' } : null;
        return [{ key, value, label, facts: facts(raw.facts) }];
      }),
      insight: isObject(breakdown.insight) && str(breakdown.insight.code) ? { code: str(breakdown.insight.code) ?? '', facts: facts(breakdown.insight.facts) } : null,
    },
    today: list(body.today).flatMap((raw): TodayEvent[] => (isObject(raw) ? [{ kind: str(raw.kind) ?? '', startsAt: str(raw.starts_at), endsAt: str(raw.ends_at), subject: subject(raw.subject), facts: facts(raw.facts) }] : [])),
    streak: parseStreak(body.streak),
    assistantEnabled: isObject(body.assistant) && body.assistant.enabled === true,
  };
}

export async function fetchToday(scope: TodayScope, signal?: AbortSignal): Promise<TodayData> {
  const parsed = parseToday(await request(`/today?scope=${encodeURIComponent(scope)}`, { signal }));
  if (!parsed) throw new Error('today: unreadable answer');
  return parsed;
}
