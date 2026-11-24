import { describe, expect, it } from 'vitest';
import { KNOWN_BRANDS, brandOf, luminance, markOf, prefersWhiteInk } from './providerBrand';

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('provider brands', () => {
  it('hold their text colour at AA (4.5:1) on the brand colour', () => {
    expect(KNOWN_BRANDS.length).toBeGreaterThanOrEqual(2);
    for (const [provider, brand] of KNOWN_BRANDS) expect(contrast(brand.bg, brand.fg), provider).toBeGreaterThanOrEqual(4.5);
  });

  it('know a provider by its id, give an unknown or inherited one the neutral card, and always have a mark letter', () => {
    expect(brandOf('monzo')?.mark).toBe('M');
    for (const unknown of ['acme-bank', 'toString', '']) expect(brandOf(unknown)).toBeNull();
    expect(markOf('acme-bank')).toBe('A');
    expect(markOf('')).toBe('?');
    expect(markOf('monobank')).toBe('m');
  });

  it('chooses the ink of a logo by the card\'s real background: white on a dark brand colour, dark on a light one', () => {
    expect(prefersWhiteInk('#16181d')).toBe(true);
    expect(prefersWhiteInk('#b3261e')).toBe(true);
    expect(prefersWhiteInk('#ffffff')).toBe(false);
    expect(prefersWhiteInk('#f5c518')).toBe(false);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });
});
