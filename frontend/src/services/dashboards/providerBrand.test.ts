import { describe, expect, it } from 'vitest';
import { KNOWN_BRANDS, brandOf, markOf } from './providerBrand';

const luminance = (hex: string) => {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
};
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
});
