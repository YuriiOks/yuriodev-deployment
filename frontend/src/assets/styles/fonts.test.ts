import { describe, expect, it } from 'vitest';
import globalCss from './global.css?raw';
import dashboardType from './dashboard-type.module.css?raw';

// Fira Code is self-hosted: every @font-face points at a woff2 file in assets/fonts, no request leaves the site.
const files = import.meta.glob('/src/assets/fonts/*.woff2', { query: '?url', import: 'default', eager: true });

const faces = [...globalCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);

describe('self-hosted Fira Code', () => {
  it('has the latin, symbols, cyrillic and cyrillic-ext subsets, one face each, as the variable font', () => {
    const sources = faces.map((face) => /url\('([^']+)'\)/.exec(face)?.[1]);
    expect(sources.sort()).toEqual([
      '../fonts/fira-code-cyrillic-ext.woff2',
      '../fonts/fira-code-cyrillic.woff2',
      '../fonts/fira-code-latin.woff2',
      '../fonts/fira-code-symbols2.woff2',
    ]);
    for (const face of faces) {
      expect(face).toMatch(/font-family:\s*'Fira Code'/);
      expect(face).toMatch(/font-weight:\s*300 700/);
      expect(face).toMatch(/font-display:\s*swap/);
      expect(face).toMatch(/format\('woff2'\)/);
      expect(face).toMatch(/unicode-range:/);
    }
  });

  it('the Cyrillic faces cover Russian letters', () => {
    const cyrillic = faces.find((face) => face.includes('fira-code-cyrillic.woff2'))!;
    expect(cyrillic).toContain('U+0400-045F');
    const ext = faces.find((face) => face.includes('fira-code-cyrillic-ext.woff2'))!;
    expect(ext).toContain('U+0460-052F');
  });

  it('every font file the CSS names exists, and none is loaded from another origin', () => {
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(4);
    for (const name of ['latin', 'symbols2', 'cyrillic', 'cyrillic-ext']) {
      expect(Object.keys(files), name).toContain(`/src/assets/fonts/fira-code-${name}.woff2`);
    }
    expect(globalCss).not.toMatch(/url\(\s*['"]?https?:/);
  });
});

// The private dashboards use the platform's Fira Code too (no second face), and keep it for data through one utility.
describe('the dashboards use Fira Code', () => {
  it('sets their interface in the site\'s monospace and ships no other face', () => {
    expect(dashboardType).toMatch(/\.dashNum\s*\{[^}]*font-family:\s*var\(--font-mono\)/);
    expect(dashboardType).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(globalCss).not.toContain('Fira Sans');
    expect(Object.keys(files).filter((name) => name.includes('fira-sans'))).toEqual([]);
  });
});
