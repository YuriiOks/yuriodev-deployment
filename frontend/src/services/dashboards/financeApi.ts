import { isIconUri, request } from './liveApi';

/*
 * The read-only finance API (GET /api/dashboards/v1/finance/...): accounts with their balances and the state of each bank
 * link, a page of transactions (newest first, filtered, by cursor) and a per-currency summary of this month. Money is an
 * integer in minor units next to its ISO code. Every parser keeps only what it can use, so a wrong field drops a row and never
 * breaks the page.
 */

export type ConnectionStatus = 'ok' | 'needs_reconsent' | 'paused';

/** An amount converted into the display currency (pounds) at the server's latest rate. */
export interface Converted {
  readonly amount: number;
  readonly currency: string;
}

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
  /** The owner's own money converted into the display currency, when the server has a rate for this currency (null: show the original only). */
  readonly display: Converted | null;
}

/** A bank's official wordmark, one image for a dark card and one for a light one (data URIs the server keeps in its settings). */
export interface ProviderLogo {
  readonly light: string | null;
  readonly dark: string | null;
}

export interface FinanceConnection {
  readonly provider: string;
  readonly status: ConnectionStatus;
  readonly lastOkAt: string | null;
  /** The provider's logo when the server has one; null: the text name is shown. */
  readonly logo: ProviderLogo | null;
}

export interface FinanceAccounts {
  readonly accounts: readonly FinanceAccount[];
  readonly connections: readonly FinanceConnection[];
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
}

export interface TransactionsPage {
  readonly transactions: readonly FinanceTransaction[];
  readonly nextCursor: string | null;
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
  readonly currencies: readonly CurrencySummary[];
  /** One total in the display currency, and when the rate behind it is from (null until the server sends them). */
  readonly total: Converted | null;
  readonly rateAsOf: string | null;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
const int = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) ? value : null);
const CURRENCY = /^[A-Z]{3}$/;
const currency = (value: unknown): string | null => (typeof value === 'string' && CURRENCY.test(value) ? value : null);

/*
 * The converted figures and the logos are read under the names the server is expected to use (`display_balance` and `display_amount` with
 * `display_currency`, a summary `display_total`, `rate_as_of`, a connection `logo` with `light` and `dark`); until the server sends them
 * every field is null and the page shows the originals and the text names. A wrong or missing field only drops that one slot.
 */
const converted = (amount: unknown, code: unknown): Converted | null => {
  const value = int(amount);
  const cur = currency(code);
  return value !== null && cur ? { amount: value, currency: cur } : null;
};

const logoOf = (raw: unknown): ProviderLogo | null => {
  if (!isObject(raw)) return null;
  const light = isIconUri(raw.light) ? raw.light : null;
  const dark = isIconUri(raw.dark) ? raw.dark : null;
  return light || dark ? { light, dark } : null;
};

const STATUSES: readonly ConnectionStatus[] = ['ok', 'needs_reconsent', 'paused'];

export function parseAccounts(body: unknown): FinanceAccounts | null {
  if (!isObject(body) || !Array.isArray(body.accounts)) return null;
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
        display: converted(raw.display_balance, raw.display_currency),
      },
    ];
  });
  const connections = (Array.isArray(body.connections) ? body.connections : []).flatMap((raw): FinanceConnection[] => {
    if (!isObject(raw)) return [];
    const provider = text(raw.provider);
    const status = STATUSES.find((candidate) => candidate === raw.status);
    return provider && status ? [{ provider, status, lastOkAt: text(raw.last_ok_at), logo: logoOf(raw.logo) }] : [];
  });
  return { accounts, connections };
}

export function parseTransaction(raw: unknown): FinanceTransaction | null {
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
    display: converted(raw.display_amount, raw.display_currency),
  };
}

export function parseTransactions(body: unknown): TransactionsPage | null {
  if (!isObject(body) || !Array.isArray(body.transactions)) return null;
  return {
    transactions: body.transactions.flatMap((raw) => {
      const parsed = parseTransaction(raw);
      return parsed ? [parsed] : [];
    }),
    nextCursor: text(body.next_cursor),
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
  return { month: text(body.month) ?? '', asOf: text(body.as_of), currencies, total: converted(body.display_total, body.display_currency), rateAsOf: text(body.rate_as_of) };
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
  readonly q?: string;
  readonly cursor?: string | null;
  readonly limit?: number;
}

/** The query string of a transactions request: only what is set. */
export function transactionsPath({ account, q, cursor, limit = 25 }: TransactionQuery): string {
  const params = new URLSearchParams();
  if (account) params.set('account', account);
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
