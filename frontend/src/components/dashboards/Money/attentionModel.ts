import type { AttentionItem, AttentionKind } from '../../../services/dashboards/recurringApi';
import type { Plural } from '../../../services/dashboards/recurringStrings';

/** Severity order: the money problems first, then what is due, then a link to approve, a statement out of date, and last the informational "amount changed". */
export const SEVERITY: readonly AttentionKind[] = ['overdraft', 'due_not_covered', 'missed_payment', 'reconsent', 'credit_high', 'stale_statement', 'amount_changed'];

/** Everything but "amount changed" is urgent: the strip shows the most urgent one in words without being opened. */
export const isUrgent = (kind: AttentionKind): boolean => kind !== 'amount_changed';

export interface AttentionGroup {
  readonly kind: AttentionKind;
  readonly items: readonly AttentionItem[];
}

/** The active items grouped by kind, in severity order (empty groups left out); inside a group the server's order is kept. */
export function groupAttention(items: readonly AttentionItem[]): AttentionGroup[] {
  const active = items.filter((item) => item.state === 'active');
  return SEVERITY.flatMap((kind) => {
    const inKind = active.filter((item) => item.kind === kind);
    return inKind.length > 0 ? [{ kind, items: inKind }] : [];
  });
}

/** The single most urgent active item (the first of the most severe urgent kind), or null when nothing is urgent. */
export function mostUrgent(items: readonly AttentionItem[]): AttentionItem | null {
  return groupAttention(items).find((group) => isUrgent(group.kind))?.items[0] ?? null;
}

/** The right form of a counted noun for a language ("1 card", "2 cards"; Russian "1 карта", "2 карты", "5 карт"). */
export function pluralForm(forms: Plural, n: number, lang: string): string {
  const category = new Intl.PluralRules(lang).select(n);
  const form = category === 'one' ? forms.one : category === 'few' ? forms.few : category === 'many' ? forms.many : forms.other;
  return form ?? forms.other;
}
