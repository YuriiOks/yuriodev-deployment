import { describe, expect, it } from 'vitest';
import { formatMinor, formatMinorParts, minorToInput, parseMinor } from './money';
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

describe('formatMinorParts', () => {
  const text = (parts: ReturnType<typeof formatMinorParts>) => parts.map((part) => part.text).join('');
  const kinds = (parts: ReturnType<typeof formatMinorParts>) => parts.map((part) => `${part.kind}:${part.text}`);

  it('splits an amount into sign, symbol, pounds and pence, in the order the language writes them', () => {
    expect(kinds(formatMinorParts(-177169, 'GBP', 'en'))).toEqual(['sign:-', 'symbol:£', 'int:1', 'int:,', 'int:771', 'frac:.', 'frac:69']);
    expect(text(formatMinorParts(-177169, 'GBP', 'en'))).toBe(formatMinor(-177169, 'GBP', 'en'));
    // Russian puts the symbol after the figure.
    const ru = formatMinorParts(17, 'UAH', 'ru');
    expect(ru[ru.length - 1]).toEqual({ kind: 'symbol', text: '₴' });
    expect(text(ru)).toBe(formatMinor(17, 'UAH', 'ru'));
  });

  it('has no fraction for a currency with none, and falls back to one plain part for a code it cannot write', () => {
    expect(formatMinorParts(500, 'JPY', 'en').some((part) => part.kind === 'frac')).toBe(false);
    expect(formatMinorParts(12345, 'XXQ', 'en').length).toBeGreaterThan(0);
  });
});

describe('parseMinor', () => {
  it('reads a typed amount as minor units, with either decimal sign and spaces, and refuses what the currency cannot hold', () => {
    expect(parseMinor('12.99', 'GBP')).toBe(1299);
    expect(parseMinor('12,5', 'GBP')).toBe(1250);
    expect(parseMinor('1 234', 'GBP')).toBe(123400);
    expect(parseMinor('500', 'JPY')).toBe(500);
    expect(parseMinor('12.999', 'GBP')).toBeNull();
    expect(parseMinor('0', 'GBP')).toBeNull();
    expect(parseMinor('-3', 'GBP')).toBeNull();
    expect(parseMinor('abc', 'GBP')).toBeNull();
    expect(parseMinor('', 'GBP')).toBeNull();
  });

  it('writes minor units back as the text an input takes', () => {
    expect(minorToInput(1299, 'GBP')).toBe('12.99');
    expect(minorToInput(500, 'JPY')).toBe('500');
    expect(parseMinor(minorToInput(1250, 'GBP'), 'GBP')).toBe(1250);
  });
});
