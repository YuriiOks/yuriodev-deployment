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
