import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../../services/dashboards/providerBrand';
import { buildAccountBody, hasEnoughContrast, providerIdFor, type AccountFields } from './manualCreate';

const fields = (extra: Partial<AccountFields> = {}): AccountFields => ({ name: 'Everyday', kind: 'current', currency: 'GBP', amount: '12.50', owed: '', last4: '', asOf: '', ...extra });

describe('making a bank entered by hand', () => {
  it('derives a neutral provider id from a name: lower-case letters, digits and hyphens, short, and not one in use', () => {
    expect(providerIdFor('Corner Credit Union!', new Set())).toBe('corner-credit-union');
    expect(providerIdFor('  Café   Bank 2 ', new Set())).toBe('cafe-bank-2');
    expect(providerIdFor('Corner Credit Union', new Set(['corner-credit-union']))).toBe('corner-credit-union-2');
    expect(providerIdFor('Corner Credit Union', new Set(['corner-credit-union', 'corner-credit-union-2']))).toBe('corner-credit-union-3');
    expect(providerIdFor('A very long name for a small bank that goes on and on', new Set())!.length).toBeLessThanOrEqual(32);
    expect(providerIdFor('!!!', new Set())).toBeNull();
    expect(providerIdFor('Банк', new Set())).toBeNull();
  });

  it('holds the card colour and its text to the contrast the server asks for', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(hasEnoughContrast('#7a2e8e', '#ffffff')).toBe(true);
    expect(hasEnoughContrast('#7a2e8e', '#7b2f8f')).toBe(false);
    expect(hasEnoughContrast('#50ffeb', '#321e37')).toBe(true);
  });

  it('builds an account body: a balance (which may be below nothing) or, for a card, its limit and what is owed; or names the wrong field', () => {
    expect(buildAccountBody(fields(), 'c-1')).toEqual({ body: { connection_id: 'c-1', name: 'Everyday', kind: 'current', currency: 'GBP', balance: 1250 } });
    expect(buildAccountBody(fields({ amount: '-3', asOf: '2026-11-20', last4: '1234', currency: 'gbp' }), 'c-1')).toEqual({ body: { connection_id: 'c-1', name: 'Everyday', kind: 'current', currency: 'GBP', balance: -300, as_of: '2026-11-20', mask_last4: '1234' } });
    expect(buildAccountBody(fields({ kind: 'credit_card', amount: '3000', owed: '' }), 'c-1')).toEqual({ body: { connection_id: 'c-1', name: 'Everyday', kind: 'credit_card', currency: 'GBP', credit_limit: 300000, owed: 0 } });
    expect(buildAccountBody(fields({ kind: 'credit_card', amount: '3000', owed: '120.5' }), 'c-1')).toMatchObject({ body: { credit_limit: 300000, owed: 12050 } });
    expect(buildAccountBody(fields({ name: ' ' }), 'c-1')).toEqual({ problem: 'name' });
    expect(buildAccountBody(fields({ currency: 'pounds' }), 'c-1')).toEqual({ problem: 'currency' });
    expect(buildAccountBody(fields({ amount: 'lots' }), 'c-1')).toEqual({ problem: 'amount' });
    expect(buildAccountBody(fields({ kind: 'credit_card', amount: '0' }), 'c-1')).toEqual({ problem: 'limit' });
    expect(buildAccountBody(fields({ kind: 'credit_card', amount: '100', owed: '-1' }), 'c-1')).toEqual({ problem: 'owed' });
    expect(buildAccountBody(fields({ last4: '12' }), 'c-1')).toEqual({ problem: 'last4' });
  });
});
