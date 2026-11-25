import { int, isObject, text } from './financeApi';
import { ApiError, request } from './liveApi';

/*
 * Banks without an API (POST /api/dashboards/v1/finance/manual/...): the owner enters a balance with a date, or uploads a downloaded
 * statement. Nothing is read from or sent to the bank. A statement is read in full or not at all: a dry run says what an upload
 * would do (to check against the bank's own statement), a bad line is told by its row.
 */

export interface StatementLineError {
  readonly row: number;
  readonly field: string | null;
  readonly message: string;
}

export interface StatementResult {
  readonly layout: string;
  readonly dryRun: boolean;
  readonly parsed: number;
  readonly created: number;
  readonly duplicates: number;
  readonly firstDate: string | null;
  readonly lastDate: string | null;
  /** Money in and out of the lines, as positive minor units in the account's currency. */
  readonly moneyIn: number;
  readonly moneyOut: number;
  readonly balanceApplied: boolean;
  /** The balance the file states (or its newest line carries) and its day, even on a check; `balanceWouldApply` says importing it with the balance option would set it (no newer balance is on the account). Null for a card. */
  readonly balance: number | null;
  readonly balanceDate: string | null;
  readonly balanceWouldApply: boolean;
  readonly errors: readonly StatementLineError[];
}

export function parseStatementResult(body: unknown): StatementResult | null {
  if (!isObject(body) || !Array.isArray(body.errors)) return null;
  const parsed = int(body.parsed);
  const created = int(body.created);
  const duplicates = int(body.duplicates);
  const moneyIn = int(body.money_in);
  const moneyOut = int(body.money_out);
  if (parsed === null || created === null || duplicates === null || moneyIn === null || moneyOut === null) return null;
  return {
    layout: text(body.layout) ?? '',
    dryRun: body.dry_run === true,
    parsed,
    created,
    duplicates,
    firstDate: text(body.first_date),
    lastDate: text(body.last_date),
    moneyIn,
    moneyOut,
    balanceApplied: body.balance_applied === true,
    balance: int(body.balance),
    balanceDate: text(body.balance_date),
    balanceWouldApply: body.balance_would_apply === true,
    errors: body.errors.flatMap((raw): StatementLineError[] => {
      if (!isObject(raw)) return [];
      const row = int(raw.row);
      const message = text(raw.message);
      return row !== null && message ? [{ row, field: text(raw.field), message }] : [];
    }),
  };
}

/** A balance as of a day (empty: now). A card sends what is owed, any other account its balance (which may be below nothing). */
export async function setManualBalance(accountId: string, value: { balance: number } | { owed: number }, asOf: string | null): Promise<void> {
  await request(`/finance/manual/accounts/${encodeURIComponent(accountId)}/balance`, { method: 'POST', body: { ...value, ...(asOf ? { as_of: asOf } : {}) } });
}

export interface StatementOptions {
  readonly dryRun: boolean;
  readonly dateOrder: 'dmy' | 'mdy' | null;
  readonly applyBalance: boolean;
}

/**
 * Uploads a statement file as the request body. Resolves with what it did (or, with `dryRun`, would do); a file with bad lines
 * resolves with its `errors` listed (nothing was written). An unreadable layout, a too large file or a network failure rejects.
 */
export async function uploadStatement(accountId: string, data: ArrayBuffer, { dryRun, dateOrder, applyBalance }: StatementOptions, signal?: AbortSignal): Promise<StatementResult> {
  const query = [dryRun ? 'dry_run=true' : '', dateOrder ? `date_order=${dateOrder}` : '', applyBalance ? 'apply_balance=true' : ''].filter(Boolean).join('&');
  const path = `/finance/manual/accounts/${encodeURIComponent(accountId)}/statement${query ? `?${query}` : ''}`;
  try {
    const parsed = parseStatementResult(await request(path, { method: 'POST', raw: { data, contentType: 'application/octet-stream' }, signal, timeoutMs: 30000 }));
    if (!parsed) throw new Error('manual: unreadable statement answer');
    return parsed;
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      const refused = parseStatementResult(error.body);
      if (refused && refused.errors.length > 0) return refused;
    }
    throw error;
  }
}

/** A bank entered by hand: a built-in brand's id, or a neutral id of the owner's own with a name and colours. Resolves with the new connection's id. */
export async function createManualConnection(body: { provider: string; displayName?: string; brandBg?: string; brandFg?: string }): Promise<string> {
  const answer = await request('/finance/manual/connections', {
    method: 'POST',
    body: { provider: body.provider, ...(body.displayName ? { display_name: body.displayName } : {}), ...(body.brandBg ? { brand_bg: body.brandBg } : {}), ...(body.brandFg ? { brand_fg: body.brandFg } : {}) },
  });
  const id = isObject(answer) ? text(answer.id) : null;
  if (!id) throw new Error('manual: unreadable connection answer');
  return id;
}

export type ManualAccountKind = 'current' | 'savings' | 'business' | 'credit_card';

/** What an account of a bank entered by hand is made from (a card: its limit and what is owed; any other: its balance, which may be below nothing). */
export interface ManualAccountBody {
  readonly connection_id: string;
  readonly name: string;
  readonly kind: ManualAccountKind;
  readonly currency: string;
  readonly balance?: number;
  readonly credit_limit?: number;
  readonly owed?: number;
  readonly as_of?: string;
  readonly mask_last4?: string;
}

export async function createManualAccount(body: ManualAccountBody): Promise<void> {
  await request('/finance/manual/accounts', { method: 'POST', body });
}

/** What an account entered by hand can have changed: its name, its type (a current account becomes a card only together with a limit above zero) and a card's limit. */
export interface ManualAccountPatch {
  readonly name?: string;
  readonly kind?: ManualAccountKind;
  readonly credit_limit?: number;
  readonly mask_last4?: string;
  readonly archived?: boolean;
}

export async function updateManualAccount(accountId: string, body: ManualAccountPatch): Promise<void> {
  await request(`/finance/accounts/${encodeURIComponent(accountId)}`, { method: 'PATCH', body });
}

/** What a bank entered by hand can have changed: its name and its colours (both colours or neither; the server checks their contrast). */
export interface ManualConnectionPatch {
  readonly displayName?: string;
  readonly brandBg?: string;
  readonly brandFg?: string;
}

export async function updateManualConnection(connectionId: string, patch: ManualConnectionPatch): Promise<void> {
  await request(`/finance/manual/connections/${encodeURIComponent(connectionId)}`, {
    method: 'PATCH',
    body: { ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}), ...(patch.brandBg !== undefined ? { brand_bg: patch.brandBg } : {}), ...(patch.brandFg !== undefined ? { brand_fg: patch.brandFg } : {}) },
  });
}

/** The currencies an account entered by hand may be in (ISO 4217, with their codes only here); an unreadable answer is an empty list and the form falls back to a code field. */
export async function fetchManualCurrencies(signal?: AbortSignal): Promise<string[]> {
  const answer = await request('/finance/manual/currencies', { signal });
  if (!isObject(answer) || !Array.isArray(answer.currencies)) return [];
  return answer.currencies.flatMap((raw): string[] => {
    const code = isObject(raw) ? text(raw.code) : null;
    return code && /^[A-Z]{3}$/.test(code) ? [code] : [];
  });
}
