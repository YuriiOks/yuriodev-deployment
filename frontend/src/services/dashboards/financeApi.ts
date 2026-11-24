import { request } from './liveApi';

/*
 * The read-only finance API (GET /api/dashboards/v1/finance/...): accounts with their balances and the state of each bank
 * link, a page of transactions (newest first, filtered, by cursor) and a per-currency summary of this month. Money is an
 * integer in minor units next to its ISO code. Every parser keeps only what it can use, so a wrong field drops a row and never
 * breaks the page.
 */

export type ConnectionStatus = 'ok' | 'needs_reconsent' | 'paused';

/** The rate a currency was converted with: display units per one unit of it (exact decimal text), as of the source's own time. */
export interface FxRate {
  readonly rate: string;
  readonly asOf: string | null;
  readonly source: string;
}

/** The root `display` block of an answer that converts: the display currency, the rates used and the currencies with no usable rate. */
export interface DisplayInfo {
  readonly currency: string;
  readonly rates: Readonly<Record<string, FxRate>>;
  /** Currencies with no rate (none, or older than three days): their display fields are null and nothing is guessed. */
  readonly missing: readonly string[];
}

/** An amount converted into the display currency (pounds) at the server's latest rate. */
export interface Converted {
  readonly amount: number;
  readonly currency: string;
}

export type AccountKind = 'current' | 'credit_card' | 'savings' | 'pot' | 'business';

const ACCOUNT_KINDS: readonly AccountKind[] = ['current', 'credit_card', 'savings', 'pot', 'business'];

/** The spending categories every provider's transactions are sorted into (the server's fixed set). */
export const CATEGORIES = [
  'housing_utilities',
  'groceries',
  'eating_out',
  'transport',
  'subscriptions',
  'health',
  'shopping',
  'entertainment',
  'debt',
  'income',
  'transfers',
  'transfers_out',
  'cash',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const isCategory = (value: unknown): value is Category => (CATEGORIES as readonly unknown[]).includes(value);

export interface FinanceAccount {
  readonly id: string;
  readonly connectionId: string;
  readonly provider: string;
  readonly name: string;
  /** "pot" for a savings pot; anything else (a current account, a card) is shown as an account. */
  readonly type: string | null;
  readonly currency: string;
  readonly maskLast4: string | null;
  /** As the provider sends it: with a credit card it includes the limit. */
  readonly balance: number;
  readonly creditLimit: number;
  /** The balance minus the credit limit: the owner's own money. */
  readonly ownBalance: number;
  readonly balanceAt: string | null;
  readonly historyFrom: string | null;
  readonly archived: boolean;
  /** What the page can rely on to present it (a pot, a credit card, a business account ...). */
  readonly kind: AccountKind;
  /** A neutral sub-type ("Platinum", "Joint", "Jar"): never a holder's name. */
  readonly label: string | null;
  /** A pot's current account. */
  readonly parentId: string | null;
  /** A pot's goal, when the bank gives one (minor units). */
  readonly goalAmount: number | null;
  /** A current account's agreed overdraft, when known. */
  readonly overdraftLimit: number | null;
  /** Whose overdraft limit is in force: the owner's own setting, or the bank's (null: none known). */
  readonly overdraftSource: 'owner' | 'bank' | null;
  /** What the bank itself sent, whether or not the owner overrides it. */
  readonly overdraftBank: number | null;
  /** What can be spent: the balance plus the overdraft. */
  readonly availableMinor: number;
  /** The owner's own money converted into the display currency, when the server has a rate for this currency (null: show the original only). */
  readonly display: Converted | null;
  /** The display figure is an approximation (another currency than the display one). */
  readonly converted: boolean;
}

/** A bank's official wordmark: one image with dark ink for a light card and one with white ink for a dark one (data URIs, from GET /finance/providers). */
export interface ProviderLogo {
  readonly onLight: string | null;
  readonly onDark: string | null;
  /** A square icon of the bank, for the small letter tiles (transaction rows, filter chips); null when the server has none. */
  readonly mark: string | null;
  /** The bank's name as the server gives it (the owner's name for it, else the built-in brand's): preferred over the page's own; null from an older server. */
  readonly name: string | null;
  /** The bank's card colours as the server gives them (AA held by the server): preferred over the table in providerBrand.ts. */
  readonly colors: { readonly background: string; readonly foreground: string } | null;
  /** Connected through its API, or entered by hand. */
  readonly entry: 'api' | 'manual' | null;
}

export interface FinanceConnection {
  /** The connection's id (what an account of a bank entered by hand is added to), when the server sends it. */
  readonly id: string | null;
  readonly provider: string;
  readonly status: ConnectionStatus;
  /** For a bank entered by hand: the date its newest data is as of (never the day it was uploaded). */
  readonly lastOkAt: string | null;
  /** Entered by hand: no collector reads it, so it has no link state, only a date its data is as of. */
  readonly manual: boolean;
  readonly displayName: string | null;
  /** Why the last read failed (a short kind), until one works. */
  readonly lastError: string | null;
  /** An API bank whose balances have not been read for a long time: they are as of `staleSince`, whatever its status says. */
  readonly stale: boolean;
  readonly staleSince: string | null;
}

export interface FinanceAccounts {
  readonly accounts: readonly FinanceAccount[];
  readonly connections: readonly FinanceConnection[];
  /** The conversion block, when the server sends one. */
  readonly display: DisplayInfo | null;
}

export interface FinanceTransaction {
  readonly id: string;
  readonly accountId: string;
  readonly bookedAt: string;
  /** Signed minor units: money out is negative. */
  readonly amount: number;
  readonly currency: string;
  readonly originalAmount: number | null;
  readonly originalCurrency: string | null;
  readonly description: string;
  readonly counterparty: string | null;
  readonly pending: boolean;
  readonly declined: boolean;
  readonly internalTransfer: boolean;
  /** The amount in the display currency (null: no rate, or already in it). */
  readonly display: Converted | null;
  readonly converted: boolean;
  /** The owner's override, else the normalised category (never missing: "other" when the server sends none). */
  readonly category: Category;
  readonly categoryOverridden: boolean;
}

export interface TransactionsPage {
  readonly transactions: readonly FinanceTransaction[];
  readonly nextCursor: string | null;
  readonly display: DisplayInfo | null;
}

export interface CurrencySummary {
  readonly currency: string;
  readonly accounts: number;
  readonly balance: number;
  readonly ownBalance: number;
  readonly spent: number;
  readonly received: number;
}

export interface FinanceSummary {
  readonly month: string;
  readonly asOf: string | null;
  /** The newest balance among the accounts counted: what "updated" says. */
  readonly asOfNewest: string | null;
  /** The oldest balance among banks read by their own API (a hand-entered bank is as old as its last statement and is not stale): the page warns when it is far behind. */
  readonly asOfOldest: string | null;
  readonly currencies: readonly CurrencySummary[];
  /** One grand total in the display currency (the converted parts, each converted once, added), null until the server sends it. */
  readonly total: Converted | null;
  /** False when a currency with no rate was left out of the grand total. */
  readonly complete: boolean;
  /** The conversion block (rates used, currencies with no rate). */
  readonly display: DisplayInfo | null;
  /** The oldest rate time among the rates used, shown once beside the total. */
  readonly rateAsOf: string | null;
}

export type Json = Record<string, unknown>;
export const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
export const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
export const int = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) ? value : null);
const CURRENCY = /^[A-Z]{3}$/;
export const currency = (value: unknown): string | null => (typeof value === 'string' && CURRENCY.test(value) ? value : null);

export const converted = (amount: unknown, code: string | null): Converted | null => {
  const value = int(amount);
  return value !== null && code ? { amount: value, currency: code } : null;
};

/** The root `display` block of an answer that converts, or null when the server sends none (an older one). */
export function parseDisplayInfo(raw: unknown): DisplayInfo | null {
  if (!isObject(raw)) return null;
  const code = currency(raw.currency);
  if (!code) return null;
  const rates: Record<string, FxRate> = {};
  if (isObject(raw.rates)) {
    for (const [name, entry] of Object.entries(raw.rates)) {
      if (CURRENCY.test(name) && isObject(entry) && typeof entry.rate === 'string' && /^\d+(\.\d+)?$/.test(entry.rate)) {
        rates[name] = { rate: entry.rate, asOf: text(entry.as_of), source: text(entry.source) ?? '' };
      }
    }
  }
  const missing = Array.isArray(raw.missing) ? raw.missing.flatMap((entry) => (currency(entry) ? [entry as string] : [])) : [];
  return { currency: code, rates, missing };
}

/** The oldest rate time among the rates used (the one the grand total is as old as). */
export function oldestRate(display: DisplayInfo | null): string | null {
  const times = Object.values(display?.rates ?? {}).flatMap((rate) => (rate.asOf && !Number.isNaN(Date.parse(rate.asOf)) ? [rate.asOf] : []));
  return times.sort()[0] ?? null;
}

const DATA_URI = /^data:image\/(?:png|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_LOGO_LENGTH = 72 * 1024;

/** A logo is a base64 PNG or SVG data URI of a sane size: never a link, so it can only be an image the server vetted. */
const logoUri = (value: unknown): string | null => (typeof value === 'string' && value.length <= MAX_LOGO_LENGTH && DATA_URI.test(value) ? value : null);

const hexColor = (value: unknown): string | null => (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : null);

const STATUSES: readonly ConnectionStatus[] = ['ok', 'needs_reconsent', 'paused'];

export function parseAccounts(body: unknown): FinanceAccounts | null {
  if (!isObject(body) || !Array.isArray(body.accounts)) return null;
  const display = parseDisplayInfo(body.display);
  const accounts = body.accounts.flatMap((raw): FinanceAccount[] => {
    if (!isObject(raw)) return [];
    const id = text(raw.id);
    const name = text(raw.name);
    const code = currency(raw.currency);
    const balance = int(raw.balance);
    if (!id || !name || !code || balance === null) return [];
    const limit = int(raw.credit_limit) ?? 0;
    return [
      {
        id,
        connectionId: text(raw.connection_id) ?? '',
        provider: text(raw.provider) ?? 'unknown',
        name,
        type: text(raw.type),
        currency: code,
        maskLast4: text(raw.mask_last4),
        balance,
        creditLimit: limit,
        ownBalance: int(raw.own_balance_minor) ?? balance - limit,
        balanceAt: text(raw.balance_at),
        historyFrom: text(raw.history_from),
        archived: raw.archived === true,
        kind: ACCOUNT_KINDS.find((candidate) => candidate === raw.kind) ?? (raw.type === 'pot' ? 'pot' : 'current'),
        label: text(raw.label),
        parentId: text(raw.parent_id),
        goalAmount: int(raw.goal_amount),
        overdraftLimit: int(raw.overdraft_limit),
        overdraftSource: raw.overdraft_limit_source === 'owner' || raw.overdraft_limit_source === 'bank' ? raw.overdraft_limit_source : null,
        overdraftBank: int(raw.overdraft_limit_bank),
        availableMinor: int(raw.available_minor) ?? balance,
        display: converted(raw.display_own_balance_minor, display?.currency ?? null),
        converted: raw.converted === true,
      },
    ];
  });
  const connections = (Array.isArray(body.connections) ? body.connections : []).flatMap((raw): FinanceConnection[] => {
    if (!isObject(raw)) return [];
    const provider = text(raw.provider);
    const status = STATUSES.find((candidate) => candidate === raw.status);
    return provider && status ? [{ id: text(raw.id), provider, status, lastOkAt: text(raw.last_ok_at), manual: raw.manual === true, displayName: text(raw.display_name), lastError: text(raw.last_error), stale: raw.stale === true, staleSince: text(raw.stale_since) }] : [];
  });
  return { accounts, connections, display };
}

export function parseTransaction(raw: unknown, displayCurrency: string | null = null): FinanceTransaction | null {
  if (!isObject(raw)) return null;
  const id = text(raw.id);
  const accountId = text(raw.account_id);
  const bookedAt = text(raw.booked_at);
  const amount = int(raw.amount);
  const code = currency(raw.currency);
  if (!id || !accountId || !bookedAt || amount === null || !code || Number.isNaN(Date.parse(bookedAt))) return null;
  const original = int(raw.original_amount);
  const originalCode = currency(raw.original_currency);
  return {
    id,
    accountId,
    bookedAt,
    amount,
    currency: code,
    originalAmount: original !== null && originalCode ? original : null,
    originalCurrency: original !== null && originalCode ? originalCode : null,
    description: typeof raw.description === 'string' ? raw.description : '',
    counterparty: text(raw.counterparty),
    pending: raw.pending === true,
    declined: raw.declined === true,
    internalTransfer: raw.internal_transfer === true,
    display: converted(raw.display_amount_minor, displayCurrency),
    converted: raw.converted === true,
    category: isCategory(raw.category) ? raw.category : 'other',
    categoryOverridden: raw.category_overridden === true,
  };
}

export function parseTransactions(body: unknown): TransactionsPage | null {
  if (!isObject(body) || !Array.isArray(body.transactions)) return null;
  const display = parseDisplayInfo(body.display);
  return {
    transactions: body.transactions.flatMap((raw) => {
      const parsed = parseTransaction(raw, display?.currency ?? null);
      return parsed ? [parsed] : [];
    }),
    nextCursor: text(body.next_cursor),
    display,
  };
}

export function parseSummary(body: unknown): FinanceSummary | null {
  if (!isObject(body) || !Array.isArray(body.currencies)) return null;
  const currencies = body.currencies.flatMap((raw): CurrencySummary[] => {
    if (!isObject(raw)) return [];
    const code = currency(raw.currency);
    const balance = int(raw.balance);
    if (!code || balance === null) return [];
    return [{ currency: code, accounts: int(raw.accounts) ?? 0, balance, ownBalance: int(raw.own_balance) ?? balance, spent: int(raw.spent) ?? 0, received: int(raw.received) ?? 0 }];
  });
  const display = parseDisplayInfo(body.display);
  const grand = isObject(body.display) ? body.display : null;
  return {
    month: text(body.month) ?? '',
    asOf: text(body.as_of),
    asOfNewest: text(body.as_of_newest),
    asOfOldest: text(body.as_of_oldest),
    currencies,
    total: converted(grand?.own_balance, display?.currency ?? null),
    complete: grand?.complete === true,
    display,
    rateAsOf: oldestRate(display),
  };
}

const BAD = (what: string) => new Error(`finance: unreadable ${what}`);

export async function fetchFinanceAccounts(signal?: AbortSignal): Promise<FinanceAccounts> {
  const parsed = parseAccounts(await request('/finance/accounts', { signal }));
  if (!parsed) throw BAD('accounts');
  return parsed;
}

export async function fetchFinanceSummary(signal?: AbortSignal): Promise<FinanceSummary> {
  const parsed = parseSummary(await request('/finance/summary', { signal }));
  if (!parsed) throw BAD('summary');
  return parsed;
}

export interface TransactionQuery {
  readonly account?: string | null;
  readonly category?: Category | null;
  /** The first day wanted, "YYYY-MM-DD" (days in the server's time zone, both ends included). */
  readonly from?: string | null;
  readonly q?: string;
  readonly cursor?: string | null;
  readonly limit?: number;
}

/** The query string of a transactions request: only what is set. */
export function transactionsPath({ account, category, from, q, cursor, limit = 25 }: TransactionQuery): string {
  const params = new URLSearchParams();
  if (account) params.set('account', account);
  if (category) params.set('category', category);
  if (from) params.set('from', from);
  const query = q?.trim();
  if (query) params.set('q', query);
  if (cursor) params.set('cursor', cursor);
  params.set('limit', String(Math.min(Math.max(1, limit), 100)));
  return `/finance/transactions?${params.toString()}`;
}

export async function fetchTransactions(query: TransactionQuery, signal?: AbortSignal): Promise<TransactionsPage> {
  const parsed = parseTransactions(await request(transactionsPath(query), { signal }));
  if (!parsed) throw BAD('transactions');
  return parsed;
}

/** One category's spend this month and the month before (positive minor units). */
export interface CategorySpend {
  readonly category: Category;
  readonly spent: number;
  /** The same category the month before, in full. */
  readonly previous: number;
  /** The month before up to the same day and time as now (null for a month that is over, or an older server). */
  readonly previousToDate: number | null;
}

/** Money out in one currency by category (internal transfers and declined payments left out). */
export interface CurrencyCategories {
  readonly currency: string;
  readonly spent: number;
  readonly previousSpent: number;
  readonly previousToDateSpent: number | null;
  readonly categories: readonly CategorySpend[];
  /** Whether this currency is not the display one (its blocks are shown as they are in native mode). */
  readonly converted: boolean;
}

/** The categories of all currencies converted (each line once) and added per category, biggest first: what the pounds view shows. */
export interface DisplayCategories {
  readonly currency: string;
  /** False when a currency with no rate was left out. */
  readonly complete: boolean;
  readonly spent: number;
  readonly previousSpent: number;
  readonly previousToDateSpent: number | null;
  readonly categories: readonly CategorySpend[];
  readonly missing: readonly string[];
  readonly rateAsOf: string | null;
}

export interface FinanceCategories {
  readonly month: string;
  readonly previousMonth: string;
  /** The day of the previous month the "to date" figures are counted up to (the same day and time as now); null unless the month is the current one. */
  readonly previousToDateDay: string | null;
  readonly currencies: readonly CurrencyCategories[];
  readonly display: DisplayCategories | null;
}

export function parseCategories(body: unknown): FinanceCategories | null {
  if (!isObject(body) || !Array.isArray(body.currencies)) return null;
  const currencies = body.currencies.flatMap((raw): CurrencyCategories[] => {
    if (!isObject(raw) || !Array.isArray(raw.categories)) return [];
    const code = currency(raw.currency);
    const spent = int(raw.spent);
    if (!code || spent === null) return [];
    const categories = raw.categories.flatMap((entry): CategorySpend[] => {
      if (!isObject(entry) || !isCategory(entry.category)) return [];
      const value = int(entry.spent);
      return value === null ? [] : [{ category: entry.category, spent: value, previous: int(entry.previous) ?? 0, previousToDate: int(entry.previous_to_date) }];
    });
    return [{ currency: code, spent, previousSpent: int(raw.previous_spent) ?? 0, previousToDateSpent: int(raw.previous_to_date_spent), categories, converted: raw.converted === true }];
  });
  const info = parseDisplayInfo(body.display);
  const root = isObject(body.display) ? body.display : null;
  const lines = Array.isArray(root?.categories)
    ? (root.categories as unknown[]).flatMap((entry): CategorySpend[] => {
        if (!isObject(entry) || !isCategory(entry.category)) return [];
        const value = int(entry.spent);
        return value === null ? [] : [{ category: entry.category, spent: value, previous: int(entry.previous) ?? 0, previousToDate: int(entry.previous_to_date) }];
      })
    : [];
  const display: DisplayCategories | null =
    info && root && int(root.spent) !== null
      ? { currency: info.currency, complete: root.complete === true, spent: int(root.spent) ?? 0, previousSpent: int(root.previous_spent) ?? 0, previousToDateSpent: int(root.previous_to_date_spent), categories: lines, missing: info.missing, rateAsOf: oldestRate(info) }
      : null;
  return { month: text(body.month) ?? '', previousMonth: text(body.previous_month) ?? '', previousToDateDay: text(body.previous_to_date_day), currencies, display };
}

export async function fetchCategories(month?: string, signal?: AbortSignal): Promise<FinanceCategories> {
  const parsed = parseCategories(await request(month ? `/finance/categories?month=${encodeURIComponent(month)}` : '/finance/categories', { signal }));
  if (!parsed) throw BAD('categories');
  return parsed;
}

/** The banks' logos by provider id, from GET /finance/providers (fetched once: the data URIs are big and the accounts answer does not repeat them). */
export function parseProviders(body: unknown): Record<string, ProviderLogo> | null {
  if (!isObject(body) || !Array.isArray(body.providers)) return null;
  const logos: Record<string, ProviderLogo> = {};
  for (const raw of body.providers) {
    if (!isObject(raw)) continue;
    const id = text(raw.id);
    const logo = isObject(raw.logo) ? raw.logo : {};
    const onLight = logoUri(logo.on_light);
    const onDark = logoUri(logo.on_dark);
    const mark = logoUri(logo.mark);
    const name = text(raw.name);
    const background = isObject(raw.colors) ? hexColor(raw.colors.background) : null;
    const foreground = isObject(raw.colors) ? hexColor(raw.colors.foreground) : null;
    const colors = background && foreground ? { background, foreground } : null;
    const entry = raw.entry === 'api' || raw.entry === 'manual' ? raw.entry : null;
    if (id && (onLight || onDark || mark || name || colors || entry)) logos[id] = { onLight, onDark, mark, name, colors, entry };
  }
  return logos;
}

export async function fetchProviders(signal?: AbortSignal): Promise<Record<string, ProviderLogo>> {
  const parsed = parseProviders(await request('/finance/providers', { signal }));
  if (!parsed) throw BAD('providers');
  return parsed;
}
