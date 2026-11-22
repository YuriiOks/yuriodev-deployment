import { describe, expect, it } from 'vitest';
import globalCss from './global.css?raw';
import dashboardFontsCss from './dashboard-fonts.css?raw';
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

// Fira Sans is the private dashboards' interface face: self-hosted like Fira Code, loaded only by DashboardShell.
const sansFaces = [...dashboardFontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);

describe('self-hosted Fira Sans for the dashboards', () => {
  it('has latin and cyrillic at 400, 500 and 600, one static face each', () => {
    const sources = sansFaces.map((face) => /url\('([^']+)'\)/.exec(face)?.[1]).sort();
    expect(sources).toEqual(
      ['cyrillic', 'latin'].flatMap((subset) => [400, 500, 600].map((w) => `../fonts/fira-sans-${subset}-${w}.woff2`)).sort(),
    );
    for (const face of sansFaces) {
      expect(face).toMatch(/font-family:\s*'Fira Sans'/);
      expect(face).toMatch(/font-weight:\s*(400|500|600);/);
      expect(face).toMatch(/font-display:\s*swap/);
      expect(face).toMatch(/format\('woff2'\)/);
      expect(face).toMatch(/unicode-range:/);
    }
  });

  it('the cyrillic faces cover Russian letters, the latin faces plain ASCII', () => {
    for (const face of sansFaces.filter((f) => f.includes('-cyrillic-'))) expect(face).toContain('U+0400-045F');
    for (const face of sansFaces.filter((f) => f.includes('-latin-'))) expect(face).toContain('U+0000-00FF');
  });

  it('every file exists next to the licence, nothing comes from another origin', () => {
    for (const subset of ['latin', 'cyrillic']) {
      for (const w of [400, 500, 600]) expect(Object.keys(files)).toContain(`/src/assets/fonts/fira-sans-${subset}-${w}.woff2`);
    }
    expect(dashboardFontsCss).not.toMatch(/url\(\s*['"]?https?:/);
    expect(dashboardFontsCss).toContain('OFL');
  });

  it('is not part of the public stylesheet', () => {
    expect(globalCss).not.toContain('Fira Sans');
  });

  it('keeps Fira Code for data through one utility', () => {
    expect(dashboardType).toMatch(/\.dashNum\s*\{[^}]*font-family:\s*var\(--font-mono\)/);
    expect(dashboardType).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});
