import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './liveApi';
import { bulkAttention, iconUrl, markPaid, movedOn, parseAttention, parseRecurring, parseRecurringList, parseUpcoming, refusal } from './recurringApi';

const row = (extra: Record<string, unknown> = {}) => ({ id: 'r-1', name: 'Streaming', kind: 'subscription', amount: 999, currency: 'GBP', frequency: 'monthly', frequency_interval: 1, ...extra });

describe('the recurring payments parsers', () => {
  it('keeps an https icon and a #rrggbb colour only, and drops a row that has no usable name, amount, currency, kind or frequency', () => {
    expect(iconUrl('https://icons.example.com/a.png')).toBe('https://icons.example.com/a.png');
    for (const bad of ['http://icons.example.com/a.png', 'javascript:alert(1)', 'https://x.example.com/a b.png', 'https://x.example.com/"onerror', '//x.example.com/a.png', 12, null]) expect(iconUrl(bad)).toBeNull();
    expect(parseRecurring(row({ icon_url: 'http://x.example.com/a.png', color: '#3366cc' }))).toMatchObject({ iconUrl: null, color: '#3366cc' });
    expect(parseRecurring(row({ color: 'red' }))?.color).toBeNull();
    for (const broken of [{ name: '' }, { amount: '9.99' }, { currency: 'gbp' }, { kind: 'gift' }, { frequency: 'sometimes' }]) expect(parseRecurring(row(broken))).toBeNull();
    expect(parseRecurringList({ recurring: [row(), { nonsense: true }, row({ id: 'r-2' })] })?.recurring.map((item) => item.id)).toEqual(['r-1', 'r-2']);
    expect(parseRecurringList({})).toBeNull();
  });

  it('reads the schedule state and the evidence the bank\'s own lines give, and treats a row without them as unchecked', () => {
    const verified = parseRecurring(row({ is_installment: true, total_installments: 12, completed_installments: 3, assumed_installments: 7, scheduled_installments: 10, schedule_state: 'on_track', evidence: { last_matched_on: '2026-11-02', last_matched_amount: 999, matched_of_last: 2, checked: 3 } }));
    expect(verified).toMatchObject({ assumedInstallments: 7, scheduledInstallments: 10, scheduleState: 'on_track', evidence: { lastMatchedOn: '2026-11-02', lastMatchedAmount: 999, matchedOfLast: 2, checked: 3 } });
    expect(parseRecurring(row({ schedule_state: 'ended_by_schedule', evidence: null }))).toMatchObject({ scheduleState: 'ended_by_schedule', evidence: null });
    expect(parseRecurring(row({ schedule_state: 'sometime', evidence: { matched_of_last: 'x', checked: 3 } }))).toMatchObject({ scheduleState: null, evidence: null, assumedInstallments: 0, scheduledInstallments: null });
    expect(parseRecurring(row())).toMatchObject({ scheduleState: null, evidence: null });
  });

  it('reads the converted figures against the display currency of the answer', () => {
    const parsed = parseRecurringList({ recurring: [row({ currency: 'USD', display_amount: 790, converted: true, remaining_balance: 5000, display_remaining_balance: 3950 })], display: { currency: 'GBP', rates: {}, missing: [] } });
    expect(parsed?.recurring[0]).toMatchObject({ display: { amount: 790, currency: 'GBP' }, displayRemaining: { amount: 3950, currency: 'GBP' }, converted: true });
  });

  it('reads the upcoming window with its totals and the grand total, and keeps "covered" three-valued', () => {
    const parsed = parseUpcoming({
      from_date: '2026-11-23',
      to_date: '2026-12-07',
      items: [
        { recurring_id: 'r-1', name: 'A', kind: 'utility', due_date: '2026-11-24', days_until: 1, amount: 100, currency: 'GBP', covered: true },
        { recurring_id: 'r-2', name: 'B', kind: 'utility', due_date: '2026-11-25', days_until: 2, amount: 100, currency: 'GBP', covered: false, shortfall: 40, account_currency: 'GBP' },
        { recurring_id: 'r-3', name: 'C', kind: 'utility', due_date: '2026-11-26', days_until: 3, amount: 100, currency: 'GBP', covered: null },
        { recurring_id: '', name: 'dropped', kind: 'utility', due_date: '2026-11-26', days_until: 3, amount: 100, currency: 'GBP' },
      ],
      totals: [{ currency: 'GBP', amount: 300, display_amount: null, converted: false }],
      display: { currency: 'GBP', rates: {}, missing: ['JPY'], complete: false, total: 300 },
    });
    expect(parsed?.items.map((item) => item.covered)).toEqual([true, false, null]);
    expect(parsed?.items[1]).toMatchObject({ shortfall: 40, accountCurrency: 'GBP', accountShortTotal: null, overdue: false });
    expect(parsed?.grand).toEqual({ amount: 300, currency: 'GBP', complete: false });
    expect(parsed?.totals).toHaveLength(1);
    expect(parseUpcoming({})).toBeNull();
  });

  it('reads the attention items with their facts and state, and counts the hidden ones', () => {
    const parsed = parseAttention({
      items: [
        { key: 'k1', kind: 'overdraft', title: 'x', subject_type: 'account', subject_id: 'a-1', amount: 100, currency: 'GBP', facts: { over_by: 100, nested: { no: 1 } }, state: 'active' },
        { key: 'k2', kind: 'unknown_kind', title: 'x', subject_type: 'account', subject_id: 'a-1', state: 'active' },
      ],
      hidden: 2,
      display: { currency: 'GBP', rates: {}, missing: [] },
    });
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0].facts).toEqual({ over_by: 100 });
    expect(parsed?.hidden).toBe(2);
    // No severity from an older server: the server's own table by kind; a given one is kept; an unknown one falls back too.
    const rated = parseAttention({ items: [{ key: 'a', kind: 'overdraft', subject_type: 'account', subject_id: 'x', state: 'active', title: 't' }, { key: 'b', kind: 'overdrawn', severity: 'info', subject_type: 'account', subject_id: 'x', state: 'active', title: 't' }, { key: 'c', kind: 'credit_high', severity: 'urgent', subject_type: 'account', subject_id: 'x', state: 'active', title: 't' }], hidden: 0, display: null });
    expect(rated?.items.map((entry) => entry.severity)).toEqual(['high', 'info', 'medium']);
    expect(parseAttention({ hidden: 1 })).toBeNull();
  });

  it('reads what the audit added: overdue payments, the account\'s whole gap, the subject and provider of an item, and a connection that is not read', () => {
    const upcoming = parseUpcoming({ items: [{ recurring_id: 'r-1', name: 'A', kind: 'utility', due_date: '2026-11-20', days_until: -4, amount: 100, currency: 'GBP', covered: false, shortfall: 40, account_short_total: 90, overdue: true }], totals: [] });
    expect(upcoming?.items[0]).toMatchObject({ daysUntil: -4, overdue: true, shortfall: 40, accountShortTotal: 90 });
    const parsed = parseAttention({ items: [{ key: 'k', kind: 'stale_connection', subject_type: 'connection', subject_id: 'c-1', subject_name: 'Acme Bank', provider: 'acme-bank', state: 'active', title: 't', facts: { hours_old: 30 } }], hidden: 0 });
    expect(parsed?.items[0]).toMatchObject({ kind: 'stale_connection', severity: 'medium', subjectName: 'Acme Bank', provider: 'acme-bank' });
    expect(parseAttention({ items: [{ key: 'k', kind: 'overdraft', subject_type: 'account', subject_id: 'a', state: 'active', title: 't' }] })?.items[0]).toMatchObject({ subjectName: null, provider: null });
  });

  it('sends the due date with "paid", names a 409 as moved on, and reads the keys a bulk accept took', async () => {
    const calls: { path: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ path: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (String(url).endsWith('/paid') && calls.length === 2) return new Response(JSON.stringify({ error: 'conflict', message: 'This payment has already moved on' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      if (String(url).endsWith('/bulk')) return new Response(JSON.stringify({ items: [], missing: [], accepted: ['a', 'b'] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    await markPaid('r-1', '2026-12-01');
    expect(calls[0].body).toEqual({ due_date: '2026-12-01' });
    let caught: unknown = null;
    await markPaid('r-1').catch((error) => (caught = error));
    expect(movedOn(caught)).toBe(true);
    expect(movedOn(new ApiError('network', 0, 'network'))).toBe(false);
    expect(await bulkAttention(['a', 'b'], 'accept')).toEqual({ accepted: ['a', 'b'] });
    vi.unstubAllGlobals();
  });

  it('passes on the server\'s refusal words and nothing generic', () => {
    expect(refusal(new ApiError('validation_error', 422, 'amount must be positive'))).toBe('amount must be positive');
    expect(refusal(new ApiError('http', 422, 'HTTP 422'))).toBeNull();
    expect(refusal(new ApiError('internal_error', 500, 'boom'))).toBeNull();
    expect(refusal(new ApiError('network', 0, 'network'))).toBeNull();
    expect(refusal(new Error('amount must be positive'))).toBeNull();
    expect(refusal('nope')).toBeNull();
  });
});
