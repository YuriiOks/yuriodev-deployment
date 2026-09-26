import { describe, expect, it } from 'vitest';

// Budgets for the visual system (see _variables.css and recipes.module.css).
const styles = import.meta.glob('/src/**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const RECIPES = '/src/assets/styles/recipes.module.css';

/** "file:line: text" for every line of every stylesheet that matches `re`. */
function linesMatching(re: RegExp, files: Record<string, string> = styles): string[] {
  const found: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) found.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  return found;
}

describe('glass', () => {
  it('backdrop-filter appears only in recipes.module.css (glass is for chrome)', () => {
    expect(Object.keys(styles).length).toBeGreaterThan(10);
    const outside = Object.fromEntries(Object.entries(styles).filter(([file]) => file !== RECIPES));
    expect(linesMatching(/backdrop-filter\s*:/, outside)).toEqual([]);
  });

  it('every backdrop-filter has its -webkit- twin, for Safari', () => {
    // Declarations only: one per line, ending in a semicolon (not the @supports test).
    const recipes = styles[RECIPES];
    const standard = recipes.match(/^\s*backdrop-filter\s*:[^;{}\n]+;/gm)?.map((d) => d.trim()) ?? [];
    const webkit = recipes.match(/^\s*-webkit-backdrop-filter\s*:[^;{}\n]+;/gm)?.map((d) => d.trim()) ?? [];
    expect(standard.length).toBeGreaterThan(0);
    expect(webkit.map((d) => d.replace('-webkit-', ''))).toEqual(standard);
  });
});

describe('one cyan and one amber', () => {
  // The duplicate cyans and oranges that sat beside the brand tokens. Colour
  // the thing with --cyan* / --amber* (or a legacy alias) in _variables.css.
  const DUPLICATES =
    /#(?:06b6d4|22d3ee|0891b2|0e7490|00bcd4|00d4ff|0059b3|f97316|ea580c|c2410c|fb923c|ff9800|f59e0b|d97706|ffc107)\b|\b(?:6,\s*182,\s*212|0,\s*212,\s*255|0,\s*89,\s*179|249,\s*115,\s*22|245,\s*158,\s*11|217,\s*119,\s*6|255,\s*193,\s*7|234,\s*88,\s*12|251,\s*146,\s*60)\b/i;

  it('no stylesheet outside _variables.css spells out a brand cyan or amber', () => {
    const outside = Object.fromEntries(Object.entries(styles).filter(([file]) => !file.endsWith('/_variables.css')));
    expect(linesMatching(DUPLICATES, outside)).toEqual([]);
  });
});
