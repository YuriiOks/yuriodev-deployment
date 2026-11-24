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
