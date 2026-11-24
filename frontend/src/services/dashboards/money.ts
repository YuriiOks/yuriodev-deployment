import type { Lang } from './types';

/** How many decimal places a currency has (2 for most, 0 for the yen, 3 for the dinar), from the platform's own tables. */
function digitsOf(code: string): number {
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

/** An amount in minor units as text in the page's language: "1 234,50 ₴". Falls back to "1234.50 XYZ" for a code the platform does not know. */
export function formatMinor(minor: number, code: string, lang: Lang, { signed = false }: MoneyOptions = {}): string {
  const digits = digitsOf(code);
  const value = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat(lang, { style: 'currency', currency: code, signDisplay: signed ? 'exceptZero' : 'auto' }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${code}`;
  }
}
