import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseStatementResult, setManualBalance, uploadStatement } from './manualApi';

const result = (extra: Record<string, unknown> = {}) => ({ layout: 'csv', dry_run: true, parsed: 3, created: 2, duplicates: 1, first_date: '2026-10-01', last_date: '2026-10-31', money_in: 150000, money_out: 4550, balance_applied: false, errors: [], ...extra });

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('the manual bank API', () => {
  it('reads a statement answer: the totals, the dates and each bad line, and refuses an answer without its numbers', () => {
    expect(parseStatementResult(result())).toEqual({ layout: 'csv', dryRun: true, parsed: 3, created: 2, duplicates: 1, firstDate: '2026-10-01', lastDate: '2026-10-31', moneyIn: 150000, moneyOut: 4550, balanceApplied: false, balance: null, balanceDate: null, balanceWouldApply: false, errors: [] });
    expect(parseStatementResult(result({ errors: [{ row: 4, field: 'amount', message: 'not a number' }, { row: 'x' }, { row: 9, field: null, message: 'bad date' }] }))?.errors).toEqual([
      { row: 4, field: 'amount', message: 'not a number' },
      { row: 9, field: null, message: 'bad date' },
    ]);
    expect(parseStatementResult(result({ parsed: 'three' }))).toBeNull();
    expect(parseStatementResult({ errors: [] })).toBeNull();
    expect(parseStatementResult(null)).toBeNull();
  });

  it('sends the balance with its date (a card: what is owed), and leaves the date out when there is none', async () => {
    const fetchMock = answer(200, {});
    await setManualBalance('acc-1', { balance: -1250 }, '2026-11-20');
    await setManualBalance('acc-2', { owed: 5000 }, null);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe('/api/dashboards/v1/finance/manual/accounts/acc-1/balance');
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ balance: -1250, as_of: '2026-11-20' });
    expect(JSON.parse(calls[1][1].body as string)).toEqual({ owed: 5000 });
  });

  it('uploads the file as it is, with the options in the address, and returns what the server says', async () => {
    const fetchMock = answer(200, result());
    const data = new TextEncoder().encode('date,description,amount\n2026-10-01,Coffee,-3.50\n').buffer;
    const done = await uploadStatement('acc-1', data, { dryRun: true, dateOrder: 'dmy', applyBalance: true });
    expect(done.parsed).toBe(3);
    const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe('/api/dashboards/v1/finance/manual/accounts/acc-1/statement?dry_run=true&date_order=dmy&apply_balance=true');
    expect(init.body).toBe(data);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream');
    await uploadStatement('acc-1', data, { dryRun: false, dateOrder: null, applyBalance: false });
    expect((fetchMock.mock.calls as unknown as [string][])[1][0]).toBe('/api/dashboards/v1/finance/manual/accounts/acc-1/statement');
  });

  it('returns the bad lines of a refused file (nothing was written), and rejects when the layout is not known', async () => {
    answer(422, result({ errors: [{ row: 2, field: 'date', message: 'cannot read the date' }], created: 0 }));
    const refused = await uploadStatement('acc-1', new ArrayBuffer(1), { dryRun: true, dateOrder: null, applyBalance: false });
    expect(refused.errors).toEqual([{ row: 2, field: 'date', message: 'cannot read the date' }]);
    answer(422, { error: 'unknown_layout', message: 'The file is in no known layout', request_id: 'x' });
    await expect(uploadStatement('acc-1', new ArrayBuffer(1), { dryRun: true, dateOrder: null, applyBalance: false })).rejects.toThrow('The file is in no known layout');
  });
});
