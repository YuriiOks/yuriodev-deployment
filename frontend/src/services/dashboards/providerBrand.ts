/**
 * A bank's card colours in the wallet: its brand colour with the text colour held at AA on it (providerBrand.test.ts), and the
 * one letter of its mark. An unknown provider gets the neutral card (the dashboards' own surface and text), so a new bank never
 * breaks the page. Only public brand colours live here, never anything about the owner.
 */
export interface Brand {
  /** The card's solid brand colour (a deeper shade of it where the pure colour would not hold AA for the ink). */
  readonly bg: string;
  /** The ink on it: the brand's own ink (white, or a dark one on a light colour). */
  readonly fg: string;
  /** The mark's letter (the first letter of the id when left out). */
  readonly mark?: string;
}

/**
 * Public brand colours by provider id (never the logos themselves: those come from the server). Each ink is held at 4.5:1 on its
 * colour by providerBrand.test.ts, so the small lines on a card read as well as its large amount; where the pure brand colour is too
 * light for white ink, the nearest deeper shade of the same hue is used and the ink stays the brand's.
 */
const BRANDS: Readonly<Record<string, Brand>> = {
  monobank: { bg: '#000000', fg: '#ffffff', mark: 'm' },
  monzo: { bg: '#c9364a', fg: '#ffffff', mark: 'M' },
  barclays: { bg: '#0079b3', fg: '#ffffff' },
  lloyds: { bg: '#006a4d', fg: '#ffffff' },
  starling: { bg: '#50ffeb', fg: '#321e37' },
  wise: { bg: '#9fe870', fg: '#163300' },
  revolut: { bg: '#ffffff', fg: '#191c1f' },
  aqua: { bg: '#0000a6', fg: '#ffffff' },
  paypal: { bg: '#002991', fg: '#ffffff' },
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

/** A bank's card colours: the server's own pair when it sends one (it is the source for a bank the repo must not name), else the table above, else null (the neutral card). */
export function brandFor(provider: string, info?: { readonly colors: { readonly background: string; readonly foreground: string } | null } | null): Brand | null {
  return info?.colors ? { bg: info.colors.background, fg: info.colors.foreground } : brandOf(provider);
}
