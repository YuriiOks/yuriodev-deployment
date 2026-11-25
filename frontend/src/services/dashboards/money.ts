import type { Lang } from './types';

/** How many decimal places a currency has (2 for most, 0 for the yen, 3 for the dinar), from the platform's own tables. */
export function digitsOf(code: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export interface MoneyOptions {
  /** Show a "+" for money in and a "−" for money out (a plain amount shows only a "−" for a negative one). */
  readonly signed?: boolean;
}

/** The approximation mark, with a no-break space so it never wraps away from its figure. */
export const APPROX = '\u2248\u00a0';

/** The minus the platform writes as a hyphen (English) is written as the real minus sign (U+2212), as Russian already is: one sign in both languages. */
const typographic = (text: string): string => text.replace(/-/g, '\u2212');

/** An amount in minor units as text in the page's language, with the currency's own symbol in both languages ("1 234,50 ₴", "₴1,234.50"; never "UAH 1,234.50"). Falls back to "1234.50 XYZ" for a code the platform does not know. */
export function formatMinor(minor: number, code: string, lang: Lang, { signed = false }: MoneyOptions = {}): string {
  const digits = digitsOf(code);
  const value = minor / 10 ** digits;
  try {
    return typographic(new Intl.NumberFormat(lang, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol', signDisplay: signed ? 'exceptZero' : 'auto' }).format(value));
  } catch {
    return `${value.toFixed(digits)} ${code}`;
  }
}

export type AmountPartKind = 'sign' | 'symbol' | 'int' | 'frac' | 'other';

export interface AmountPart {
  readonly kind: AmountPartKind;
  readonly text: string;
}

/**
 * An amount in minor units as its parts, in the order the language writes them, so a card can set the pounds big and the symbol and
 * the pence small ("−£1,771.69"): sign, symbol, integer (with its grouping), fraction (with its separator), anything else.
 */
export function formatMinorParts(minor: number, code: string, lang: Lang): AmountPart[] {
  const digits = digitsOf(code);
  const value = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat(lang, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(value).map((part): AmountPart => {
      switch (part.type) {
        case 'minusSign':
        case 'plusSign':
          return { kind: 'sign', text: typographic(part.value) };
        case 'currency':
          return { kind: 'symbol', text: part.value };
        case 'integer':
        case 'group':
          return { kind: 'int', text: part.value };
        case 'decimal':
        case 'fraction':
          return { kind: 'frac', text: part.value };
        default:
          return { kind: 'other', text: part.value };
      }
    });
  } catch {
    return [{ kind: 'int', text: `${value.toFixed(digits)} ${code}` }];
  }
}

/**
 * A typed amount ("12.99", "12,99", "1 234.5") as minor units of a currency, or null when it is not a positive number with no more
 * decimals than the currency has (with `signed`: a balance, which may be negative or nothing). No rounding: an amount the currency cannot hold is refused, as the server does.
 */
export function parseMinor(input: string, code: string, { signed = false }: { signed?: boolean } = {}): number | null {
  // Both the hyphen and the real minus sign (what the page itself writes) are read as a minus.
  const typed = input.replace(/[\s\u00a0]/g, '').replace(',', '.').replace(/^\u2212/, '-');
  const negative = signed && typed.startsWith('-');
  const value = negative ? typed.slice(1) : typed;
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const digits = digitsOf(code);
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > digits) return null;
  const minor = Number(whole + fraction.padEnd(digits, '0'));
  if (!Number.isSafeInteger(minor)) return null;
  // A payment is more than nothing; a balance (signed) may be nothing, and below it.
  if (!signed && minor <= 0) return null;
  return negative ? -minor : minor;
}

/** Minor units as the plain decimal text an input takes ("1299" in pounds is "12.99"). */
export function minorToInput(minor: number, code: string): string {
  const digits = digitsOf(code);
  return digits === 0 ? String(minor) : (minor / 10 ** digits).toFixed(digits);
}
