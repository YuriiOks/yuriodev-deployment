import type { FinanceAccount, FinanceConnection } from './financeApi';

/** One bank: its accounts and the state of its link, in the order the API lists them. */
export interface Bank {
  readonly provider: string;
  readonly accounts: readonly FinanceAccount[];
  readonly connection: FinanceConnection | undefined;
}

/** The accounts grouped by provider (first appearance first); a provider with only a link row is a bank with no accounts. */
export function groupBanks(accounts: readonly FinanceAccount[], connections: readonly FinanceConnection[]): Bank[] {
  const providers = [...new Set(accounts.map((account) => account.provider))];
  for (const connection of connections) if (!providers.includes(connection.provider)) providers.push(connection.provider);
  return providers.map((provider) => ({
    provider,
    accounts: accounts.filter((account) => account.provider === provider),
    connection: connections.find((connection) => connection.provider === provider),
  }));
}

export const isPot = (account: FinanceAccount): boolean => account.type === 'pot';

/** An account with nothing in it: no balance and no debt (a business account that is never used, an empty pot). */
export const isEmpty = (account: FinanceAccount): boolean => account.balance === 0 && account.ownBalance === 0;

export interface CurrencyTotal {
  readonly currency: string;
  /** The owner's own money in this currency across the open accounts (a credit card counts what is owed as negative). */
  readonly own: number;
  /** The part of it that sits in pots. */
  readonly pots: number;
  readonly accounts: number;
}

/** Totals per currency over the accounts that are not archived; never summed across currencies. */
export function totalsByCurrency(accounts: readonly FinanceAccount[]): CurrencyTotal[] {
  const totals = new Map<string, { own: number; pots: number; accounts: number }>();
  for (const account of accounts) {
    if (account.archived) continue;
    const entry = totals.get(account.currency) ?? { own: 0, pots: 0, accounts: 0 };
    entry.own += account.ownBalance;
    if (isPot(account)) entry.pots += account.ownBalance;
    entry.accounts += 1;
    totals.set(account.currency, entry);
  }
  return [...totals.entries()].map(([currency, entry]) => ({ currency, ...entry }));
}

/** A bank's own money per currency, with the part in pots (the opened bank's header). */
export function bankTotals(bank: Bank): CurrencyTotal[] {
  return totalsByCurrency(bank.accounts);
}

export interface BankSplit {
  /** Accounts with something in them (or owed on them), then the empty ones folded away. */
  readonly accounts: readonly FinanceAccount[];
  readonly emptyAccounts: readonly FinanceAccount[];
  readonly pots: readonly FinanceAccount[];
  readonly emptyPots: readonly FinanceAccount[];
  readonly archived: readonly FinanceAccount[];
}

/** An opened bank's accounts: the main accounts and the pots, each with its empty ones folded; archived accounts apart. */
export function splitBank(bank: Bank): BankSplit {
  const open = bank.accounts.filter((account) => !account.archived);
  const accounts = open.filter((account) => !isPot(account));
  const pots = open.filter(isPot);
  return {
    accounts: accounts.filter((account) => !isEmpty(account)),
    emptyAccounts: accounts.filter(isEmpty),
    pots: pots.filter((account) => !isEmpty(account)),
    emptyPots: pots.filter(isEmpty),
    archived: bank.accounts.filter((account) => account.archived),
  };
}

export type CreditKind = 'debt' | 'overdrawn' | 'none';

export interface CreditUse {
  readonly kind: CreditKind;
  /** What is owed, positive (minor units). */
  readonly used: number;
  readonly limit: number;
  /** How much of the limit is used, 0 to 100 (rounded; 100 when it is over). */
  readonly percent: number;
  /** What is left of the limit; never below zero. */
  readonly free: number;
}

/**
 * How an account reads. With a credit limit, `own_balance_minor` is minus what is owed, so the card reads as a debt with
 * "used X of the limit"; an account with no limit and a negative balance is overdrawn; anything else is just a balance.
 */
export function creditUse(account: FinanceAccount): CreditUse {
  const limit = account.creditLimit;
  const owed = Math.max(0, -account.ownBalance);
  if (limit > 0) {
    return { kind: owed > 0 ? 'debt' : 'none', used: owed, limit, percent: Math.min(100, Math.round((owed / limit) * 100)), free: Math.max(0, limit - owed) };
  }
  if (account.ownBalance < 0) return { kind: 'overdrawn', used: owed, limit: 0, percent: 0, free: 0 };
  return { kind: 'none', used: 0, limit: 0, percent: 0, free: 0 };
}

/** The emoji a pot's name starts with (its picture) and the name without it. */
export function potParts(name: string): { emoji: string | null; label: string } {
  const match = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*/u.exec(name);
  if (!match) return { emoji: null, label: name };
  const label = name.slice(match[0].length).trim();
  return label === '' ? { emoji: null, label: name } : { emoji: match[1], label };
}

/** Names that two accounts of one bank share (they need something else to tell them apart). */
export function sharedNames(accounts: readonly FinanceAccount[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const account of accounts) {
    const key = account.name.trim().toLowerCase();
    if (seen.has(key)) shared.add(key);
    seen.add(key);
  }
  return shared;
}
