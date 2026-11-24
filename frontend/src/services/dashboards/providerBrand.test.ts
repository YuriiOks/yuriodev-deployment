import { describe, expect, it } from 'vitest';
import { KNOWN_BRANDS, brandOf, luminance, markOf, prefersWhiteInk } from './providerBrand';

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('provider brands', () => {
  it('hold their ink at AA (4.5:1) on the brand colour, so the small lines on a card read as well as its amount', () => {
    expect(KNOWN_BRANDS.length).toBeGreaterThanOrEqual(9);
    for (const [provider, brand] of KNOWN_BRANDS) expect(contrast(brand.bg, brand.fg), provider).toBeGreaterThanOrEqual(4.5);
  });

  it('know a provider by its id, give an unknown or inherited one the neutral card, and always have a mark letter', () => {
    expect(brandOf('monzo')?.mark).toBe('M');
    for (const unknown of ['acme-bank', 'toString', '']) expect(brandOf(unknown)).toBeNull();
    expect(markOf('acme-bank')).toBe('A');
    expect(markOf('')).toBe('?');
    expect(markOf('monobank')).toBe('m');
    expect(markOf('starling')).toBe('S');
  });

  it('chooses the ink of a logo by the card\'s real background: white on a dark brand colour, dark on a light one', () => {
    expect(prefersWhiteInk('#000000')).toBe(true);
    expect(prefersWhiteInk('#b3261e')).toBe(true);
    expect(prefersWhiteInk('#ffffff')).toBe(false);
    // Every brand's ink side agrees with its colour: a dark card takes white ink, a light one dark ink.
    for (const [provider, brand] of KNOWN_BRANDS) expect(prefersWhiteInk(brand.bg), provider).toBe(brand.fg === '#ffffff');
    expect(prefersWhiteInk('#f5c518')).toBe(false);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });
});
