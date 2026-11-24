import { describe, expect, it } from 'vitest';
import { formatMinor } from './money';
import { providerName, reconnectPath } from '../../components/dashboards/Money/providers';

const plain = (text: string) => text.replace(/[\s\u00a0\u202f]/g, ' ');

describe('formatMinor', () => {
  it('turns minor units into the currency\'s own major units, with its decimals', () => {
    expect(plain(formatMinor(45050, 'GBP', 'en'))).toBe('£450.50');
    expect(plain(formatMinor(45050, 'USD', 'ru'))).toMatch(/450,50 \$/);
    expect(plain(formatMinor(500, 'JPY', 'en'))).toMatch(/500/);
    expect(plain(formatMinor(500, 'JPY', 'en'))).not.toMatch(/\./);
  });

  it('writes the currency symbol in both languages, never the code', () => {
    expect(plain(formatMinor(17, 'UAH', 'en'))).toBe('₴0.17');
    expect(plain(formatMinor(17, 'UAH', 'ru'))).toBe('0,17 ₴');
    expect(plain(formatMinor(21, 'EUR', 'en'))).toBe('€0.21');
    expect(plain(formatMinor(21000, 'USD', 'en'))).toBe('$210.00');
    expect(plain(formatMinor(21000, 'USD', 'ru'))).toBe('210,00 $');
    expect(plain(formatMinor(100, 'GBP', 'ru'))).toBe('1,00 £');
  });

  it('puts a sign on money in and out only when asked, and never on zero', () => {
    expect(formatMinor(-450, 'GBP', 'en')).toBe('-£4.50');
    expect(formatMinor(450, 'GBP', 'en')).toBe('£4.50');
    expect(formatMinor(450, 'GBP', 'en', { signed: true })).toBe('+£4.50');
    expect(formatMinor(-450, 'GBP', 'en', { signed: true })).toBe('-£4.50');
    expect(formatMinor(0, 'GBP', 'en', { signed: true })).toBe('£0.00');
  });

  it('falls back to a plain number and the code for a code the platform does not know', () => {
    expect(formatMinor(12345, 'XXQ', 'en')).toMatch(/123\.45/);
  });
});

describe('providers', () => {
  it('shows an id as a name, and knows a reconnect route only for the provider that has one', () => {
    expect(providerName('some-bank')).toBe('Some bank');
    expect(providerName('')).toBe('');
    expect(reconnectPath('toString')).toBeNull();
    expect(reconnectPath('acme-bank')).toBeNull();
    expect(reconnectPath('monzo')).toBe('/api/dashboards/v1/finance/monzo/connect');
  });
});
