/**
 * A bank's card colours in the wallet: its brand colour with the text colour held at AA on it (providerBrand.test.ts), and the
 * one letter of its mark. An unknown provider gets the neutral card (the dashboards' own surface and text), so a new bank never
 * breaks the page. Only public brand colours live here, never anything about the owner.
 */
export interface Brand {
  readonly bg: string;
  readonly fg: string;
  /** The mark's letter. */
  readonly mark: string;
}

const BRANDS: Readonly<Record<string, Brand>> = {
  monzo: { bg: '#b3261e', fg: '#ffffff', mark: 'M' },
  monobank: { bg: '#16181d', fg: '#ffffff', mark: 'm' },
};

/** The brand of a provider id, or null (the neutral card). */
export function brandOf(provider: string): Brand | null {
  return Object.prototype.hasOwnProperty.call(BRANDS, provider) ? BRANDS[provider] : null;
}

/** The brands, for the contrast test. */
export const KNOWN_BRANDS: ReadonlyArray<readonly [string, Brand]> = Object.entries(BRANDS);

/** The letter for a provider that has no brand: its first letter, capitalised. */
export function markOf(provider: string): string {
  return brandOf(provider)?.mark ?? (Array.from(provider.trim())[0] ?? '?').toLocaleUpperCase();
}
