import { describe, expect, it } from 'vitest';
import type { AttentionItem, AttentionKind, Severity } from '../../../services/dashboards/recurringApi';
import { groupAttention, orderedActive } from './attentionModel';

const item = (key: string, kind: AttentionKind, severity: Severity, state: AttentionItem['state'] = 'active'): AttentionItem => ({
  key,
  kind,
  severity,
  title: key,
  subjectType: 'account',
  subjectId: 'x',
  subjectName: null,
  provider: null,
  dueDate: null,
  amount: null,
  currency: null,
  display: null,
  converted: false,
  facts: {},
  state,
  snoozedUntil: null,
});

describe('the attention order', () => {
  it('groups the active items by kind, most severe first as the server rates them, then by kind, and keeps the server\'s order inside a group', () => {
    const items = [item('a', 'overdrawn', 'info'), item('b', 'amount_changed', 'medium'), item('c', 'overdraft', 'high'), item('d', 'amount_changed', 'medium'), item('e', 'stale_statement', 'high'), item('f', 'overdraft', 'high', 'dismissed')];
    expect(groupAttention(items).map((group) => [group.kind, group.severity, group.items.map((entry) => entry.key)])).toEqual([
      ['overdraft', 'high', ['c']],
      ['stale_statement', 'high', ['e']],
      ['amount_changed', 'medium', ['b', 'd']],
      ['overdrawn', 'info', ['a']],
    ]);
    expect(orderedActive(items).map((entry) => entry.key)).toEqual(['c', 'e', 'b', 'd', 'a']);
  });

  it('takes a group\'s severity from its most severe item', () => {
    const items = [item('a', 'credit_high', 'info'), item('b', 'credit_high', 'high'), item('c', 'amount_changed', 'medium')];
    expect(groupAttention(items).map((group) => group.kind)).toEqual(['credit_high', 'amount_changed']);
  });

  it('puts a kind it does not know last within its severity', () => {
    const items = [item('a', 'brand_new' as AttentionKind, 'medium'), item('b', 'amount_changed', 'medium')];
    expect(orderedActive(items).map((entry) => entry.key)).toEqual(['b', 'a']);
  });

  it('has no groups when nothing is active', () => {
    expect(groupAttention([item('a', 'overdraft', 'high', 'snoozed')])).toEqual([]);
  });
});
