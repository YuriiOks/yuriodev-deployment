import { converted, currency, int, isObject, parseDisplayInfo, text, type Converted, type DisplayInfo } from './financeApi';
import { ApiError, request } from './liveApi';

/*
 * Recurring payments, what is coming up and what needs attention (GET|POST|PATCH /api/dashboards/v1/finance/recurring, /upcoming,
 * /attention). The owner's own notes: nothing here is sent to a bank. Money is an integer in minor units next to its ISO code; every
 * parser keeps only what it can use, so a wrong row is dropped and never breaks the page.
 */

export const RECURRING_KINDS = ['subscription', 'debt', 'utility', 'insurance', 'housing', 'service', 'one_time'] as const;
export type RecurringKind = (typeof RECURRING_KINDS)[number];

export const FREQUENCIES = ['once', 'daily', 'weekly', 'monthly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const ATTENTION_KINDS = ['due_not_covered', 'missed_payment', 'amount_changed', 'credit_high', 'overdraft', 'overdrawn', 'reconsent', 'stale_statement'] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** How much an item matters, as the server sets it: high acts now, medium looks soon, info is a plain fact. */
export const SEVERITIES = ['high', 'medium', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** What an older server's item (no `severity`) is taken to be, by its kind: the same as the server's own table. */
const FALLBACK_SEVERITY: Readonly<Record<AttentionKind, Severity>> = { due_not_covered: 'high', missed_payment: 'high', overdraft: 'high', reconsent: 'high', amount_changed: 'medium', credit_high: 'medium', stale_statement: 'medium', overdrawn: 'info' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^#[0-9a-f]{6}$/;
const ICON_URL = /^https:\/\/[^\s"'<>]+$/i;

const date = (value: unknown): string | null => (typeof value === 'string' && DATE.test(value) ? value : null);
const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null => (typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : null);

/** An icon is shown only from a plain https address (the server checks it too); anything else is dropped. */
export const iconUrl = (value: unknown): string | null => (typeof value === 'string' && value.length <= 500 && ICON_URL.test(value) ? value : null);
const color = (value: unknown): string | null => (typeof value === 'string' && COLOR.test(value) ? value : null);

export interface Recurring {
  readonly id: string;
  readonly name: string;
  readonly kind: RecurringKind;
  readonly amount: number;
  readonly currency: string;
  readonly frequency: Frequency;
  readonly frequencyInterval: number;
  readonly nextDate: string | null;
  readonly startDate: string | null;
  readonly accountId: string | null;
  readonly paymentMethod: string | null;
  readonly matchText: string | null;
  readonly isActive: boolean;
  readonly isInstallment: boolean;
  readonly totalInstallments: number | null;
  readonly completedInstallments: number | null;
  readonly totalOwed: number | null;
  readonly remainingBalance: number | null;
  readonly creditor: string | null;
  readonly iconUrl: string | null;
  readonly color: string | null;
  readonly notes: string | null;
  readonly lastPaidOn: string | null;
  /** The figures in the display currency (null: no rate, or already in it). */
  readonly display: Converted | null;
  readonly displayRemaining: Converted | null;
  readonly converted: boolean;
}

export function parseRecurring(raw: unknown, displayCurrency: string | null = null): Recurring | null {
  if (!isObject(raw)) return null;
  const id = text(raw.id);
  const name = text(raw.name);
  const code = currency(raw.currency);
  const amount = int(raw.amount);
  const kind = oneOf(RECURRING_KINDS, raw.kind);
  const frequency = oneOf(FREQUENCIES, raw.frequency);
  if (!id || !name || !code || amount === null || !kind || !frequency) return null;
  return {
    id,
    name,
    kind,
    amount,
    currency: code,
    frequency,
    frequencyInterval: int(raw.frequency_interval) ?? 1,
    nextDate: date(raw.next_payment_date),
    startDate: date(raw.start_date),
    accountId: text(raw.account_id),
    paymentMethod: text(raw.payment_method),
    matchText: text(raw.match_text),
    isActive: raw.is_active !== false,
    isInstallment: raw.is_installment === true,
    totalInstallments: int(raw.total_installments),
    completedInstallments: int(raw.completed_installments),
    totalOwed: int(raw.total_owed),
    remainingBalance: int(raw.remaining_balance),
    creditor: text(raw.creditor),
    iconUrl: iconUrl(raw.icon_url),
    color: color(raw.color),
    notes: text(raw.notes),
    lastPaidOn: date(raw.last_paid_on),
    display: converted(raw.display_amount, displayCurrency),
    displayRemaining: converted(raw.display_remaining_balance, displayCurrency),
    converted: raw.converted === true,
  };
}

export interface RecurringList {
  readonly recurring: readonly Recurring[];
  readonly display: DisplayInfo | null;
}

export function parseRecurringList(body: unknown): RecurringList | null {
  if (!isObject(body) || !Array.isArray(body.recurring)) return null;
  const display = parseDisplayInfo(body.display);
  return {
    recurring: body.recurring.flatMap((raw) => {
      const row = parseRecurring(raw, display?.currency ?? null);
      return row ? [row] : [];
    }),
    display,
  };
}

export interface UpcomingItem {
  readonly recurringId: string;
  readonly name: string;
  readonly kind: RecurringKind;
  readonly dueDate: string;
  readonly daysUntil: number;
  readonly amount: number;
  readonly currency: string;
  readonly display: Converted | null;
  readonly converted: boolean;
  readonly accountId: string | null;
  readonly paymentMethod: string | null;
  readonly iconUrl: string | null;
  readonly color: string | null;
  /** Can the paying account cover it: null when no account of ours pays or there is no rate to tell. */
  readonly covered: boolean | null;
  readonly shortfall: number | null;
  readonly accountCurrency: string | null;
}

export interface UpcomingTotal {
  readonly currency: string;
  readonly amount: number;
  readonly display: Converted | null;
  readonly converted: boolean;
}

export interface Upcoming {
  readonly from: string;
  readonly to: string;
  readonly items: readonly UpcomingItem[];
  readonly totals: readonly UpcomingTotal[];
  /** The grand total in the display currency (each currency's total converted once, added); `complete` is false when a currency had no rate. */
  readonly grand: { readonly amount: number; readonly currency: string; readonly complete: boolean } | null;
  readonly display: DisplayInfo | null;
}

export function parseUpcoming(body: unknown): Upcoming | null {
  if (!isObject(body) || !Array.isArray(body.items)) return null;
  const display = parseDisplayInfo(body.display);
  const shown = display?.currency ?? null;
  const items = body.items.flatMap((raw): UpcomingItem[] => {
    if (!isObject(raw)) return [];
    const recurringId = text(raw.recurring_id);
    const name = text(raw.name);
    const kind = oneOf(RECURRING_KINDS, raw.kind);
    const dueDate = date(raw.due_date);
    const code = currency(raw.currency);
    const amount = int(raw.amount);
    if (!recurringId || !name || !kind || !dueDate || !code || amount === null) return [];
    return [
      {
        recurringId,
        name,
        kind,
        dueDate,
        daysUntil: int(raw.days_until) ?? 0,
        amount,
        currency: code,
        display: converted(raw.display_amount, shown),
        converted: raw.converted === true,
        accountId: text(raw.account_id),
        paymentMethod: text(raw.payment_method),
        iconUrl: iconUrl(raw.icon_url),
        color: color(raw.color),
        covered: typeof raw.covered === 'boolean' ? raw.covered : null,
        shortfall: int(raw.shortfall),
        accountCurrency: currency(raw.account_currency),
      },
    ];
  });
  const totals = Array.isArray(body.totals)
    ? body.totals.flatMap((raw): UpcomingTotal[] => {
        if (!isObject(raw)) return [];
        const code = currency(raw.currency);
        const amount = int(raw.amount);
        return code && amount !== null ? [{ currency: code, amount, display: converted(raw.display_amount, shown), converted: raw.converted === true }] : [];
      })
    : [];
  const total = isObject(body.display) ? int(body.display.total) : null;
  return {
    from: date(body.from_date) ?? '',
    to: date(body.to_date) ?? '',
    items,
    totals,
    grand: display && total !== null ? { amount: total, currency: display.currency, complete: isObject(body.display) && body.display.complete === true } : null,
    display,
  };
}

export type ItemState = 'active' | 'snoozed' | 'dismissed';
export type Fact = string | number | boolean | null;

export interface AttentionItem {
  readonly key: string;
  readonly kind: AttentionKind;
  readonly severity: Severity;
  /** The server's English sentence: the page tells it in its own words from `facts` and keeps this only as a last resort. */
  readonly title: string;
  readonly subjectType: 'recurring' | 'account' | 'connection';
  readonly subjectId: string;
  readonly dueDate: string | null;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly display: Converted | null;
  readonly converted: boolean;
  readonly facts: Readonly<Record<string, Fact>>;
  readonly state: ItemState;
  readonly snoozedUntil: string | null;
}

export interface Attention {
  readonly items: readonly AttentionItem[];
  /** Dismissed and snoozed items left out of `items` (all of them are in it with `include_hidden`). */
  readonly hidden: number;
  readonly display: DisplayInfo | null;
}

export function parseAttentionItem(raw: unknown, displayCurrency: string | null = null): AttentionItem | null {
  if (!isObject(raw)) return null;
  const key = text(raw.key);
  const kind = oneOf(ATTENTION_KINDS, raw.kind);
  const subjectType = oneOf(['recurring', 'account', 'connection'] as const, raw.subject_type);
  const subjectId = text(raw.subject_id);
  const state = oneOf(['active', 'snoozed', 'dismissed'] as const, raw.state);
  if (!key || !kind || !subjectType || !subjectId || !state) return null;
  const facts: Record<string, Fact> = {};
  if (isObject(raw.facts)) {
    for (const [name, value] of Object.entries(raw.facts)) {
      if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') facts[name] = value;
    }
  }
  return {
    key,
    kind,
    severity: oneOf(SEVERITIES, raw.severity) ?? FALLBACK_SEVERITY[kind],
    title: text(raw.title) ?? '',
    subjectType,
    subjectId,
    dueDate: date(raw.due_date),
    amount: int(raw.amount),
    currency: currency(raw.currency),
    display: converted(raw.display_amount, displayCurrency),
    converted: raw.converted === true,
    facts,
    state,
    snoozedUntil: text(raw.snoozed_until),
  };
}

export function parseAttention(body: unknown): Attention | null {
  if (!isObject(body) || !Array.isArray(body.items)) return null;
  const display = parseDisplayInfo(body.display);
  return {
    items: body.items.flatMap((raw) => {
      const item = parseAttentionItem(raw, display?.currency ?? null);
      return item ? [item] : [];
    }),
    hidden: int(body.hidden) ?? 0,
    display,
  };
}

const BAD = (what: string) => new Error(`recurring: unreadable ${what}`);

export async function fetchRecurring(signal?: AbortSignal): Promise<RecurringList> {
  const parsed = parseRecurringList(await request('/finance/recurring', { signal }));
  if (!parsed) throw BAD('recurring payments');
  return parsed;
}

export async function fetchUpcoming(days: number, signal?: AbortSignal): Promise<Upcoming> {
  const parsed = parseUpcoming(await request(`/finance/upcoming?days=${days}`, { signal }));
  if (!parsed) throw BAD('upcoming payments');
  return parsed;
}

export async function fetchAttention(includeHidden: boolean, signal?: AbortSignal): Promise<Attention> {
  const parsed = parseAttention(await request(`/finance/attention${includeHidden ? '?include_hidden=true' : ''}`, { signal }));
  if (!parsed) throw BAD('attention items');
  return parsed;
}

/** "I paid it": the next date moves one step. */
export async function markPaid(id: string): Promise<void> {
  await request(`/finance/recurring/${encodeURIComponent(id)}/paid`, { method: 'POST', body: {} });
}

export async function snoozeAttention(key: string, days: number): Promise<void> {
  await request('/finance/attention/snooze', { method: 'POST', body: { key, days } });
}

/** Dismiss, snooze (`days`) or restore many items at once (the server takes at most 200 keys per request: longer lists go in several). Keys that are no longer an item are left alone. */
export async function bulkAttention(keys: readonly string[], action: 'dismiss' | 'snooze' | 'restore', days?: number): Promise<void> {
  for (let start = 0; start < keys.length; start += 200) {
    await request('/finance/attention/bulk', { method: 'POST', body: { keys: keys.slice(start, start + 200), action, ...(action === 'snooze' && days ? { days } : {}) } });
  }
}

/** Sets the overdraft limit the owner gives an account (minor units, 0 or more): it wins over a limit the bank sends. */
export async function setOverdraftLimit(accountId: string, limit: number): Promise<void> {
  await request(`/finance/accounts/${encodeURIComponent(accountId)}`, { method: 'PATCH', body: { overdraft_limit: limit } });
}

export async function dismissAttention(key: string): Promise<void> {
  await request('/finance/attention/dismiss', { method: 'POST', body: { key } });
}

export async function restoreAttention(key: string): Promise<void> {
  await request('/finance/attention/restore', { method: 'POST', body: { key } });
}

/** The fields the management form sends (a create sends all of them, an edit only what changed; `null` clears what may be empty). */
export type RecurringBody = Partial<{
  name: string;
  amount: number;
  currency: string;
  kind: RecurringKind;
  frequency: Frequency;
  frequency_interval: number;
  next_payment_date: string | null;
  account_id: string | null;
  payment_method: string | null;
  match_text: string | null;
  reminder_days: number | null;
  is_active: boolean;
  notes: string | null;
}>;

export async function createRecurring(body: RecurringBody): Promise<Recurring> {
  const parsed = parseRecurring(await request('/finance/recurring', { method: 'POST', body }));
  if (!parsed) throw BAD('the new payment');
  return parsed;
}

export async function updateRecurring(id: string, body: RecurringBody): Promise<Recurring> {
  const parsed = parseRecurring(await request(`/finance/recurring/${encodeURIComponent(id)}`, { method: 'PATCH', body }));
  if (!parsed) throw BAD('the changed payment');
  return parsed;
}

/** What the server said when it refused a change as a mistake of the request (a 4xx: its message is plain English about the field), or null: a server failure or a lost connection is told in the page's own words. */
export function refusal(error: unknown): string | null {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && error.message && !/^HTTP \d+$/.test(error.message) ? error.message : null;
}
