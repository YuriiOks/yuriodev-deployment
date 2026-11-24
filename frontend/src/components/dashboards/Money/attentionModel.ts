import type { AttentionItem, AttentionKind, Severity } from '../../../services/dashboards/recurringApi';
import type { Plural } from '../../../services/dashboards/recurringStrings';

/** The order of kinds within one severity (and the order a kind the page does not know yet takes: last). */
const KIND_ORDER: readonly AttentionKind[] = ['overdraft', 'due_not_covered', 'missed_payment', 'reconsent', 'credit_high', 'stale_statement', 'amount_changed', 'overdrawn'];
const RANK: Readonly<Record<Severity, number>> = { high: 0, medium: 1, info: 2 };

/**
 * Urgent means the strip says it in words without being opened: what the server rates high or medium. A changed amount is rated medium
 * but is a note to accept or fix, not an alarm, so it stays a chip.
 */
export const isUrgent = (item: Pick<AttentionItem, 'kind' | 'severity'>): boolean => item.severity !== 'info' && item.kind !== 'amount_changed';

export interface AttentionGroup {
  readonly kind: AttentionKind;
  readonly severity: Severity;
  readonly items: readonly AttentionItem[];
}

/** The active items grouped by kind, most severe first as the server rates them (then by kind); inside a group the server's order is kept. */
export function groupAttention(items: readonly AttentionItem[]): AttentionGroup[] {
  const active = items.filter((item) => item.state === 'active');
  const groups = [...new Set(active.map((item) => item.kind))].map((kind): AttentionGroup => {
    const inKind = active.filter((item) => item.kind === kind);
    return { kind, severity: inKind.reduce((worst, item) => (RANK[item.severity] < RANK[worst] ? item.severity : worst), inKind[0].severity), items: inKind };
  });
  const place = (kind: AttentionKind) => {
    const index = KIND_ORDER.indexOf(kind);
    return index < 0 ? KIND_ORDER.length : index;
  };
  return groups.sort((a, b) => RANK[a.severity] - RANK[b.severity] || place(a.kind) - place(b.kind));
}

/** The single most urgent active item (the first of the most severe urgent kind), or null when nothing is urgent. */
export function mostUrgent(items: readonly AttentionItem[]): AttentionItem | null {
  return groupAttention(items).flatMap((group) => group.items).find((item) => isUrgent(item)) ?? null;
}

/** The right form of a counted noun for a language ("1 card", "2 cards"; Russian "1 карта", "2 карты", "5 карт"). */
export function pluralForm(forms: Plural, n: number, lang: string): string {
  const category = new Intl.PluralRules(lang).select(n);
  const form = category === 'one' ? forms.one : category === 'few' ? forms.few : category === 'many' ? forms.many : forms.other;
  return form ?? forms.other;
}
