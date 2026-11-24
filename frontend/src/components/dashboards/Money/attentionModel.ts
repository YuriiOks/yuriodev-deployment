import type { AttentionItem, AttentionKind, Severity } from '../../../services/dashboards/recurringApi';

/** The order of kinds within one severity (and the order a kind the page does not know yet takes: last). */
const KIND_ORDER: readonly AttentionKind[] = ['overdraft', 'due_not_covered', 'missed_payment', 'reconsent', 'credit_high', 'stale_connection', 'stale_statement', 'amount_changed', 'overdrawn'];
const RANK: Readonly<Record<Severity, number>> = { high: 0, medium: 1, info: 2 };

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

/** Every active item in the order the row of cards shows them: by severity, then by kind, the server's order inside a kind. */
export function orderedActive(items: readonly AttentionItem[]): AttentionItem[] {
  return groupAttention(items).flatMap((group) => group.items);
}
