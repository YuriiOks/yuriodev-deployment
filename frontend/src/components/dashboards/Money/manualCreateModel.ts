import { contrastRatio } from '../../../services/dashboards/providerBrand';
import { parseMinor } from '../../../services/dashboards/money';
import type { ManualAccountBody, ManualAccountKind } from '../../../services/dashboards/manualApi';

/** The least contrast between a card's colour and its text the server accepts (WCAG AA for text). */
export const MIN_CONTRAST = 4.5;

export const hasEnoughContrast = (background: string, foreground: string): boolean => contrastRatio(background, foreground) >= MIN_CONTRAST;

/**
 * A neutral provider id from a bank's name: lower-case letters, digits and hyphens, at most 32 characters, and not one already in use
 * (a number is added). Null when the name has nothing a letter or digit can be made of.
 */
export function providerIdFor(name: string, taken: ReadonlySet<string>): string | null {
  if (!name.trim()) return null;
  // A name with no Latin letter or digit in it (Cyrillic, punctuation only) still makes a bank: its id is a neutral "bank", "bank-2", ...
  const base =
    name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28)
      .replace(/-+$/g, '') || 'bank';
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

export interface AccountFields {
  readonly name: string;
  readonly kind: ManualAccountKind;
  readonly currency: string;
  /** The balance (any kind but a card), or the credit limit of a card. */
  readonly amount: string;
  /** What is owed now (a card). */
  readonly owed: string;
  readonly last4: string;
  readonly asOf: string;
}

export type AccountProblem = 'name' | 'currency' | 'amount' | 'limit' | 'owed' | 'last4';

/** The body for a new account, or the field that is wrong. */
export function buildAccountBody(fields: AccountFields, connectionId: string): { body: ManualAccountBody } | { problem: AccountProblem } {
  const name = fields.name.trim();
  const currency = fields.currency.trim().toUpperCase();
  if (!name) return { problem: 'name' };
  if (!/^[A-Z]{3}$/.test(currency)) return { problem: 'currency' };
  if (fields.last4.trim() && !/^[0-9]{4}$/.test(fields.last4.trim())) return { problem: 'last4' };
  const extras = { ...(fields.asOf ? { as_of: fields.asOf } : {}), ...(fields.last4.trim() ? { mask_last4: fields.last4.trim() } : {}) };
  if (fields.kind === 'credit_card') {
    const limit = parseMinor(fields.amount, currency);
    if (limit === null) return { problem: 'limit' };
    const owed = fields.owed.trim() === '' ? 0 : parseMinor(fields.owed, currency, { signed: true });
    if (owed === null || owed < 0) return { problem: 'owed' };
    return { body: { connection_id: connectionId, name, kind: 'credit_card', currency, credit_limit: limit, owed, ...extras } };
  }
  const balance = parseMinor(fields.amount, currency, { signed: true });
  if (balance === null) return { problem: 'amount' };
  return { body: { connection_id: connectionId, name, kind: fields.kind, currency, balance, ...extras } };
}
