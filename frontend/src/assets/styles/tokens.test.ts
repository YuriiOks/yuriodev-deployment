import { describe, expect, it } from 'vitest';

// Every var(--name) used anywhere in src must be defined somewhere in src.
// A declaration that references an undefined custom property with no fallback
// is dropped by the browser, silently losing fills and borders.
const sources = import.meta.glob(['/src/**/*.{css,ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('CSS custom properties', () => {
  it('every var(--x) used in src is defined in src', () => {
    const defined = new Set<string>();
    const used = new Map<string, string[]>();

    for (const [file, text] of Object.entries(sources)) {
      for (const m of text.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)) defined.add(m[1]);
      for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
        // var(--x, fallback) is safe even when --x is undefined.
        if (m[2] === ',') continue;
        used.set(m[1], [...(used.get(m[1]) ?? []), file]);
      }
    }

    const undefinedTokens = [...used.entries()]
      .filter(([name]) => !defined.has(name))
      .map(([name, files]) => `${name} (${[...new Set(files)].join(', ')})`);

    expect(Object.keys(sources).length).toBeGreaterThan(10);
    expect(undefinedTokens).toEqual([]);
  });
});
