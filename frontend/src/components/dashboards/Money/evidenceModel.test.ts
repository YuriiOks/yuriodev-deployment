import { describe, expect, it } from 'vitest';
import type { UpcomingItem } from '../../../services/dashboards/recurringApi';
import { endedBySchedule, splitDue, truthOf } from './evidenceModel';

const item = (id: string, amount: number, extra: Partial<UpcomingItem> = {}): UpcomingItem => ({
  recurringId: id,
  name: id,
  kind: 'subscription',
  dueDate: '2026-11-24',
  daysUntil: 1,
  amount,
  currency: 'GBP',
  display: null,
  converted: false,
  accountId: null,
  paymentMethod: null,
  iconUrl: null,
  color: null,
  covered: null,
  shortfall: null,
  accountCurrency: null,
  ...extra,
});

describe('how far a payment is verified', () => {
  it('is confirmed when a bank line matched, "no charge seen" when its account is collected and nothing matched, and unchecked otherwise', () => {
    expect(truthOf({ lastMatchedOn: '2026-11-02', lastMatchedAmount: 100, matchedOfLast: 1, checked: 3 })).toBe('confirmed');
    expect(truthOf({ lastMatchedOn: null, lastMatchedAmount: null, matchedOfLast: 0, checked: 3 })).toBe('none_seen');
    expect(truthOf({ lastMatchedOn: null, lastMatchedAmount: null, matchedOfLast: 0, checked: 0 })).toBe('unchecked');
    expect(truthOf(null)).toBe('unchecked');
  });

  it('knows a plan its schedule has finished', () => {
    expect(endedBySchedule({ scheduleState: 'ended_by_schedule' })).toBe(true);
    expect(endedBySchedule({ scheduleState: 'on_track' })).toBe(false);
    expect(endedBySchedule({ scheduleState: null })).toBe(false);
  });

  it('adds what is due up by how far it is verified, per currency, in pounds where the server converted it', () => {
    const items = [item('a', 1000), item('b', 500, { currency: 'USD', display: { amount: 395, currency: 'GBP' }, converted: true }), item('c', 700), item('d', 300, { currency: 'USD' })];
    const truth = (id: string) => (id === 'a' ? 'confirmed' : id === 'b' || id === 'c' ? 'unchecked' : 'none_seen');
    const base = splitDue(items, truth, 'base');
    expect(base.confirmed).toEqual([{ currency: 'GBP', amount: 1000, approx: false }]);
    expect(base.unchecked).toEqual([{ currency: 'GBP', amount: 1095, approx: true }]);
    expect(base.none_seen).toEqual([{ currency: 'USD', amount: 300, approx: false }]);
    const native = splitDue(items, truth, 'native');
    expect(native.unchecked).toEqual([{ currency: 'USD', amount: 500, approx: false }, { currency: 'GBP', amount: 700, approx: false }]);
  });
});
