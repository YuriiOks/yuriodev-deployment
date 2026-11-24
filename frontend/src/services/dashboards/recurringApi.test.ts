import { describe, expect, it } from 'vitest';
import { ApiError } from './liveApi';
import { iconUrl, parseAttention, parseRecurring, parseRecurringList, parseUpcoming, refusal } from './recurringApi';

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
    expect(parsed?.items[1]).toMatchObject({ shortfall: 40, accountCurrency: 'GBP' });
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
    expect(parseAttention({ hidden: 1 })).toBeNull();
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
