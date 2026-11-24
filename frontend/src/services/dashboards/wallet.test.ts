import { describe, expect, it } from 'vitest';
import type { FinanceAccount, FinanceConnection } from './financeApi';
import { creditUse, groupBanks, isEmpty, potParts, sharedNames, splitBank, totalsByCurrency } from './wallet';

const acct = (id: string, extra: Partial<FinanceAccount> = {}): FinanceAccount => ({
  id,
  connectionId: 'c',
  provider: 'acme-bank',
  name: id,
  type: 'current',
  currency: 'GBP',
  maskLast4: null,
  balance: 1000,
  creditLimit: 0,
  ownBalance: 1000,
  balanceAt: null,
  historyFrom: null,
  archived: false,
  kind: 'current',
  label: null,
  parentId: null,
  goalAmount: null,
  overdraftLimit: null,
  availableMinor: 1000,
  display: null,
  ...extra,
});

describe('wallet', () => {
  it('groups accounts by provider in the order the API lists them, and adds a provider that has only a link', () => {
    const links: FinanceConnection[] = [{ provider: 'lonely-bank', status: 'paused', lastOkAt: null, logo: null }];
    const banks = groupBanks([acct('a', { provider: 'one' }), acct('b', { provider: 'two' }), acct('c', { provider: 'one' })], links);
    expect(banks.map((bank) => [bank.provider, bank.accounts.map((account) => account.id)])).toEqual([['one', ['a', 'c']], ['two', ['b']], ['lonely-bank', []]]);
    expect(banks[2].connection?.status).toBe('paused');
  });

  it('totals per currency over the open accounts, with the part in pots, never across currencies', () => {
    const totals = totalsByCurrency([
      acct('cur', { ownBalance: 5000, balance: 5000 }),
      acct('pot', { type: 'pot', kind: 'pot', ownBalance: 2000, balance: 2000 }),
      acct('eur', { currency: 'EUR', ownBalance: 700, balance: 700 }),
      acct('old', { archived: true, ownBalance: 99999, balance: 99999 }),
      acct('card', { ownBalance: -3000, balance: 7000, creditLimit: 10000 }),
    ]);
    expect(totals).toEqual([
      { currency: 'GBP', own: 4000, pots: 2000, accounts: 3 },
      { currency: 'EUR', own: 700, pots: 0, accounts: 1 },
    ]);
  });

  it('folds the empty accounts and empty pots, keeps archived ones apart, and calls an account with a debt not empty', () => {
    const split = splitBank({
      provider: 'acme-bank',
      connection: undefined,
      accounts: [
        acct('full'),
        acct('zero', { balance: 0, ownBalance: 0 }),
        acct('pot-full', { type: 'pot', kind: 'pot' }),
        acct('pot-zero', { type: 'pot', kind: 'pot', balance: 0, ownBalance: 0 }),
        acct('gone', { archived: true }),
        acct('owed', { balance: 0, ownBalance: -500 }),
      ],
    });
    expect(split.accounts.map((a) => a.id)).toEqual(['full', 'owed']);
    expect(split.emptyAccounts.map((a) => a.id)).toEqual(['zero']);
    expect(split.pots.map((a) => a.id)).toEqual(['pot-full']);
    expect(split.emptyPots.map((a) => a.id)).toEqual(['pot-zero']);
    expect(split.archived.map((a) => a.id)).toEqual(['gone']);
    expect(isEmpty(acct('z', { balance: 0, ownBalance: 0 }))).toBe(true);
  });

  it('reads a credit account as a debt with how much of the limit is used, an account below zero with no limit as overdrawn', () => {
    expect(creditUse(acct('card', { balance: 217400, creditLimit: 7000000, ownBalance: -6782600 }))).toEqual({ kind: 'debt', used: 6782600, limit: 7000000, percent: 97, free: 217400 });
    expect(creditUse(acct('paid', { balance: 7000000, creditLimit: 7000000, ownBalance: 0 })).kind).toBe('none');
    expect(creditUse(acct('over', { balance: -74782, ownBalance: -74782 }))).toMatchObject({ kind: 'overdrawn', used: 74782 });
    expect(creditUse(acct('fine'))).toMatchObject({ kind: 'none', used: 0 });
    expect(creditUse(acct('beyond', { balance: -500, creditLimit: 1000, ownBalance: -1500 })).percent).toBe(100);
  });

  it('folds business accounts away whatever is in them, and reads an agreed overdraft as used of that overdraft', () => {
    const split = splitBank({
      provider: 'acme-bank',
      connection: undefined,
      accounts: [acct('main'), acct('biz-full', { kind: 'business', balance: 9000, ownBalance: 9000 }), acct('biz-zero', { kind: 'business', balance: 0, ownBalance: 0 })],
    });
    expect(split.accounts.map((a) => a.id)).toEqual(['main']);
    expect(split.business.map((a) => a.id)).toEqual(['biz-full', 'biz-zero']);
    expect(split.emptyAccounts).toEqual([]);
    expect(creditUse(acct('over', { balance: -74782, ownBalance: -74782, overdraftLimit: 100000 }))).toEqual({ kind: 'overdrawn', used: 74782, limit: 100000, percent: 75, free: 25218 });
  });

  it('takes the emoji a pot\'s name starts with as its picture and strips it from the label', () => {
    expect(potParts('🏖️ Holiday')).toEqual({ emoji: '🏖️', label: 'Holiday' });
    expect(potParts('Rainy day')).toEqual({ emoji: null, label: 'Rainy day' });
    expect(potParts('🎁')).toEqual({ emoji: null, label: '🎁' });
    expect(potParts('👨‍👩‍👧 Family fund')).toEqual({ emoji: '👨‍👩‍👧', label: 'Family fund' });
  });

  it('finds the names two accounts of one bank share', () => {
    expect(sharedNames([acct('a', { name: 'Savings' }), acct('b', { name: 'savings ' }), acct('c', { name: 'Other' })])).toEqual(new Set(['savings']));
  });
});
