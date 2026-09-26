import { describe, expect, it } from 'vitest';

// Stacking order lives in one scale (--z-* in _variables.css). A literal
// z-index anywhere else can silently tie with or jump over another layer.
const styles = import.meta.glob('/src/**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('z-index scale', () => {
  it('every z-index outside _variables.css uses a --z-* token', () => {
    const literals: string[] = [];
    for (const [file, text] of Object.entries(styles)) {
      if (file.endsWith('/_variables.css')) continue;
      text.split('\n').forEach((line, i) => {
        const m = line.match(/z-index\s*:\s*([^;]+);?/);
        if (m && !/^var\(--z-[\w-]+\)$/.test(m[1].trim()) && m[1].trim() !== 'auto') {
          literals.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(Object.keys(styles).length).toBeGreaterThan(10);
    expect(literals).toEqual([]);
  });
});
