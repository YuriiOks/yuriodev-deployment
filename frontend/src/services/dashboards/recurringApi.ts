import { converted, currency, int, isObject, parseDisplayInfo, text, type Converted, type DisplayInfo } from './financeApi';
import type { RefusalStrings } from './refusalStrings';
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

export const ATTENTION_KINDS = ['due_not_covered', 'missed_payment', 'amount_changed', 'credit_high', 'overdraft', 'overdrawn', 'reconsent', 'stale_statement', 'stale_connection'] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** How much an item matters, as the server sets it: high acts now, medium looks soon, info is a plain fact. */
export const SEVERITIES = ['high', 'medium', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** What an older server's item (no `severity`) is taken to be, by its kind: the same as the server's own table. */
const FALLBACK_SEVERITY: Readonly<Record<AttentionKind, Severity>> = { due_not_covered: 'high', missed_payment: 'high', overdraft: 'high', reconsent: 'high', amount_changed: 'medium', credit_high: 'medium', stale_statement: 'medium', stale_connection: 'medium', overdrawn: 'info' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^#[0-9a-f]{6}$/;
const ICON_URL = /^https:\/\/[^\s"'<>]+$/i;

const date = (value: unknown): string | null => (typeof value === 'string' && DATE.test(value) ? value : null);
const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null => (typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : null);

/** An icon is shown only from a plain https address (the server checks it too); anything else is dropped. */
/** A picture the server fetched and inlined: a small raster or SVG as base64 (the page's CSP allows `data:` images). */
const ICON_DATA = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
const ICON_DATA_MAX = 150_000;

/** A payment's picture served by address: a path under the recurring routes of this site (`.../recurring/<id>/icon`), with the version query the server adds. */
const ICON_PATH = /^\/api\/dashboards\/v1\/finance\/recurring\/[A-Za-z0-9-]{1,64}\/icon(?:\?v=[0-9A-Za-z]{1,32})?$/;

export const iconUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  if (value.length <= 200 && ICON_PATH.test(value)) return value;
  if (value.length <= 500 && ICON_URL.test(value)) return value;
  return value.length <= ICON_DATA_MAX && ICON_DATA.test(value) ? value : null;
};
const iconsVersion = (value: unknown): string | null => (typeof value === 'string' && /^[0-9a-f]{16}$/.test(value) ? value : null);
const color = (value: unknown): string | null => (typeof value === 'string' && COLOR.test(value) ? value : null);

/** What the owner's own list says about a payment: on track, ended by its schedule (the last date or count is behind it), or not to be worked out. Null for a payment switched off. */
export const SCHEDULE_STATES = ['on_track', 'ended_by_schedule', 'unknown'] as const;
export type ScheduleState = (typeof SCHEDULE_STATES)[number];

/** What the bank's own lines say about a payment whose paying account is collected: the last match, and how many of the last `checked` (up to three) due dates had one. */
export interface Evidence {
  readonly lastMatchedOn: string | null;
  readonly lastMatchedAmount: number | null;
  readonly matchedOfLast: number;
  readonly checked: number;
}

function parseEvidence(raw: unknown): Evidence | null {
  if (!isObject(raw)) return null;
  const matched = int(raw.matched_of_last);
  const checked = int(raw.checked);
  if (matched === null || checked === null) return null;
  return { lastMatchedOn: date(raw.last_matched_on), lastMatchedAmount: int(raw.last_matched_amount), matchedOfLast: matched, checked };
}

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
  /** Confirmed by the bank's own lines (or by the owner's word). */
  readonly completedInstallments: number | null;
  /** Passed by the schedule only, never seen in a line. */
  readonly assumedInstallments: number;
  /** The total less the confirmed ones, as the server counts them. */
  readonly remainingInstallments: number | null;
  /** The balance if every assumed installment had been paid (an estimate), null without one. */
  readonly scheduledRemainingBalance: number | null;
  /** Confirmed plus assumed, at most the total. */
  readonly scheduledInstallments: number | null;
  readonly scheduleState: ScheduleState | null;
  /** Null when no account of ours pays it: nothing about it is checked against a bank. */
  readonly evidence: Evidence | null;
  readonly totalOwed: number | null;
  readonly remainingBalance: number | null;
  readonly creditor: string | null;
  /** The picture the server fetched, at a path on this site (`icon_url`), null while there is none. */
  readonly iconUrl: string | null;
  /** none (nothing to fetch), pending, ok or failed: while it is not ok the payment shows its colour tile. */
  readonly iconState: 'none' | 'pending' | 'ok' | 'failed';
  /** Why the last fetch of the icon failed (a short code, only when `iconState` is failed). */
  readonly iconError: string | null;
  /** A host such as example.com, whose own icon the server looks for. */
  readonly website: string | null;
  readonly color: string | null;
  readonly notes: string | null;
  /** Days before the date the owner wants to be reminded, and whether the plan renews by itself. */
  readonly reminderDays: number | null;
  readonly autoRenew: boolean;
  readonly lastPaidOn: string | null;
  /** The figures in the display currency (null: no rate, or already in it). */
  readonly display: Converted | null;
  readonly displayRemaining: Converted | null;
  /** The amount first owed, in the display currency (null: no rate, or already in it). */
  readonly displayTotalOwed: Converted | null;
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
    assumedInstallments: int(raw.assumed_installments) ?? 0,
    remainingInstallments: int(raw.remaining_installments),
    scheduledRemainingBalance: int(raw.scheduled_remaining_balance),
    scheduledInstallments: int(raw.scheduled_installments),
    scheduleState: oneOf(SCHEDULE_STATES, raw.schedule_state),
    evidence: parseEvidence(raw.evidence),
    totalOwed: int(raw.total_owed),
    remainingBalance: int(raw.remaining_balance),
    creditor: text(raw.creditor),
    iconUrl: iconUrl(raw.icon_url ?? raw.icon_data),
    iconState: oneOf(['none', 'pending', 'ok', 'failed'] as const, raw.icon_state) ?? 'none',
    iconError: text(raw.icon_error),
    website: text(raw.website),
    color: color(raw.color),
    notes: text(raw.notes),
    reminderDays: int(raw.reminder_days),
    autoRenew: raw.auto_renew === true,
    lastPaidOn: date(raw.last_paid_on),
    display: converted(raw.display_amount, displayCurrency),
    displayRemaining: converted(raw.display_remaining_balance, displayCurrency),
    displayTotalOwed: converted(raw.display_total_owed, displayCurrency),
    converted: raw.converted === true,
  };
}

export interface RecurringList {
  /** The version of the payment-icon bundle this answer expects (null from an older server). */
  readonly iconsVersion: string | null;
  readonly recurring: readonly Recurring[];
  readonly display: DisplayInfo | null;
}

export function parseRecurringList(body: unknown): RecurringList | null {
  if (!isObject(body) || !Array.isArray(body.recurring)) return null;
  const display = parseDisplayInfo(body.display);
  return {
    iconsVersion: iconsVersion(body.icons_version),
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
  /** How much of THIS payment the account cannot cover (at most its amount), in the account's currency. */
  readonly shortfall: number | null;
  /** How much the account is short in all by then, counting the earlier payments of the window. */
  readonly accountShortTotal: number | null;
  readonly accountCurrency: string | null;
  /** Already due and not seen paid: listed first, with a negative `daysUntil`. */
  readonly overdue: boolean;
}

export interface UpcomingTotal {
  readonly currency: string;
  readonly amount: number;
  readonly display: Converted | null;
  readonly converted: boolean;
}

export interface Upcoming {
  readonly iconsVersion: string | null;
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
        iconUrl: iconUrl(raw.icon_url ?? raw.icon_data),
        color: color(raw.color),
        covered: typeof raw.covered === 'boolean' ? raw.covered : null,
        shortfall: int(raw.shortfall),
        accountShortTotal: int(raw.account_short_total),
        accountCurrency: currency(raw.account_currency),
        overdue: raw.overdue === true,
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
    iconsVersion: iconsVersion(body.icons_version),
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
  /** The payment's, the account's or the bank's name, as the server gives it: the item needs no join by id. */
  readonly subjectName: string | null;
  /** The provider of an account or connection item. */
  readonly provider: string | null;
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
    subjectName: text(raw.subject_name),
    provider: text(raw.provider),
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

/** The server answered 409: the payment has moved on since the page showed it (someone paid it, or it was edited). Nothing was done. */
export function movedOn(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

/** "I paid it": the next date moves one step. `dueDate` is the date the page showed: when the payment has moved on since, nothing is done and this rejects (see `movedOn`), so a second click pays nothing. */
export async function markPaid(id: string, dueDate: string | null = null): Promise<void> {
  await request(`/finance/recurring/${encodeURIComponent(id)}/paid`, { method: 'POST', body: dueDate ? { due_date: dueDate } : {} });
}

export async function snoozeAttention(key: string, days: number): Promise<void> {
  await request('/finance/attention/snooze', { method: 'POST', body: { key, days } });
}

/** Dismiss, snooze (`days`) or restore many items at once (the server takes at most 200 keys per request: longer lists go in several). Keys that are no longer an item are left alone. */
export async function bulkAttention(keys: readonly string[], action: 'dismiss' | 'snooze' | 'restore' | 'accept', days?: number): Promise<{ accepted: string[] }> {
  const accepted: string[] = [];
  for (let start = 0; start < keys.length; start += 200) {
    const body = await request('/finance/attention/bulk', { method: 'POST', body: { keys: keys.slice(start, start + 200), action, ...(action === 'snooze' && days ? { days } : {}) } });
    if (isObject(body) && Array.isArray(body.accepted)) accepted.push(...body.accepted.filter((key): key is string => typeof key === 'string'));
  }
  return { accepted };
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
  /** A host such as example.com: the server looks for the payment's own icon there. */
  website: string | null;
  reminder_days: number | null;
  is_active: boolean;
  notes: string | null;
  start_date: string | null;
  auto_renew: boolean;
  is_installment: boolean;
  total_installments: number | null;
  completed_installments: number | null;
  total_owed: number | null;
  remaining_balance: number | null;
  creditor: string | null;
}>;

export async function createRecurring(body: RecurringBody): Promise<Recurring> {
  const parsed = parseRecurring(await request('/finance/recurring', { method: 'POST', body }));
  if (!parsed) throw BAD('the new payment');
  return parsed;
}

/** Looks for the payment's icon again: it goes back to pending and is fetched after the answer. */
export async function refreshIcon(id: string): Promise<Recurring> {
  const parsed = parseRecurring(await request(`/finance/recurring/${encodeURIComponent(id)}/icon/refresh`, { method: 'POST', body: {} }));
  if (!parsed) throw BAD('the payment');
  return parsed;
}

/** Sets the payment's icon by hand: a PNG or SVG of at most 256 KiB, sent as it is; it wins over the website until the icon is refreshed. */
export async function uploadIcon(id: string, file: { arrayBuffer(): Promise<ArrayBuffer>; type: string }): Promise<Recurring> {
  const parsed = parseRecurring(await request(`/finance/recurring/${encodeURIComponent(id)}/icon`, { method: 'POST', raw: { data: await file.arrayBuffer(), contentType: file.type } }));
  if (!parsed) throw BAD('the payment');
  return parsed;
}

/** Removes a payment for good (the server keeps nothing of it). */
export async function deleteRecurring(id: string): Promise<void> {
  await request(`/finance/recurring/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function updateRecurring(id: string, body: RecurringBody): Promise<Recurring> {
  const parsed = parseRecurring(await request(`/finance/recurring/${encodeURIComponent(id)}`, { method: 'PATCH', body }));
  if (!parsed) throw BAD('the changed payment');
  return parsed;
}

const has = (record: Readonly<Record<string, string>>, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

/** Each broken rule of a 422 (`issues`): the field it is about (the last part of the name as sent; '' for the whole body) and the page's words for the rule. */
export function refusalFields(error: unknown, words: RefusalStrings): { field: string; sentence: string }[] {
  if (!(error instanceof ApiError) || !isObject(error.body) || !Array.isArray(error.body.issues)) return [];
  const found: { field: string; sentence: string }[] = [];
  for (const raw of error.body.issues.slice(0, 20)) {
    if (!isObject(raw) || typeof raw.code !== 'string') continue;
    const bound = raw.bound === 'min' || raw.bound === 'max' ? raw.bound : null;
    const key = raw.code === 'out_of_range' && bound ? `out_of_range_${bound}` : raw.code;
    const sentence = (has(words.issues, key) ? words.issues[key] : words.issues.invalid).replace('{limit}', typeof raw.limit === 'number' ? String(raw.limit) : '');
    const field = typeof raw.field === 'string' && raw.field !== 'body' ? (raw.field.split('.').pop() ?? '') : '';
    found.push({ field, sentence });
  }
  return found;
}

/** The words for each broken rule of a 422 under its field's own name ("amount: at least 1"); at most the first three. */
export function refusalIssues(error: unknown, words: RefusalStrings): string[] {
  return refusalFields(error, words)
    .slice(0, 3)
    .map(({ field, sentence }) => (has(words.fields, field) ? `${words.fields[field]}: ${sentence}` : sentence));
}

/**
 * Why the server refused a change as a mistake of the request (a 4xx), in the page's own words: each broken rule under its field's name for a 422
 * that names them, else the words for the refusal's finer code (`reason`) or its family code (`error`). null: a server failure, a lost connection
 * or a code the page has no words for is told as the plain failure. The server's own text is never shown.
 */
export function refusal(error: unknown, words: RefusalStrings): string | null {
  if (!(error instanceof ApiError) || error.status < 400 || error.status >= 500) return null;
  const lines = refusalIssues(error, words);
  if (lines.length > 0) return lines.join('; ');
  const reason = isObject(error.body) && typeof error.body.reason === 'string' ? error.body.reason : null;
  for (const key of [reason, error.code]) {
    if (key === null) continue;
    if (has(words.codes, key)) return words.codes[key];
    if (key.endsWith('_not_found')) return words.codes.not_found;
  }
  return null;
}
