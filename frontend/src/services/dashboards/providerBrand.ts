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

/** The relative luminance (WCAG) of a #rrggbb colour, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** Whether white ink reads better than dark ink on this background (the logo variant is chosen by the card's real background, not the theme). */
export const prefersWhiteInk = (bg: string): boolean => luminance(bg) < 0.18;
