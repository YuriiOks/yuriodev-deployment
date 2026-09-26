import { describe, expect, it } from 'vitest';
import variablesCss from './_variables.css?raw';

/*
 * WCAG 2.x contrast for the colour tokens in _variables.css, resolved per
 * theme exactly as the cascade does on <html>: every `:root` block, plus the
 * theme's own block, in source order (the @media preference overrides are
 * left out: they only raise contrast). AA needs 4.5:1 for body text and 3:1
 * for large text and for UI parts such as borders and the focus ring.
 */

type Theme = 'dark' | 'light';
type Rgba = readonly [number, number, number, number];

/** Top-level `selector { declarations }` blocks, @media blocks removed. */
function blocks(css: string): Array<{ selector: string; body: string }> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<{ selector: string; body: string }> = [];
  let depth = 0;
  let start = 0;
  let selector = '';
  let skip = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) {
        selector = text.slice(start, i).trim();
        skip = selector.startsWith('@');
        start = i + 1;
      }
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        if (!skip) out.push({ selector, body: text.slice(start, i) });
        start = i + 1;
      }
    }
  }
  return out;
}

function tokensFor(theme: Theme): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const { selector, body } of blocks(variablesCss)) {
    const parts = selector.split(',').map((s) => s.trim());
    const applies = parts.some((p) => p === ':root' || p === `[data-theme="${theme}"]`);
    if (!applies) continue;
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim());
  }
  return tokens;
}

function resolve(tokens: Map<string, string>, value: string, seen: string[] = []): string {
  return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name: string) => {
    if (seen.includes(name)) throw new Error(`var() cycle: ${[...seen, name].join(' -> ')}`);
    const raw = tokens.get(name);
    if (raw === undefined) throw new Error(`undefined token ${name}`);
    return resolve(tokens, raw, [...seen, name]);
  });
}

function parseColor(value: string): Rgba {
  const v = value.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const fn = v.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const n = fn[1].split(',').map((s) => Number(s.trim()));
    if (n.length >= 3 && n.every((x) => Number.isFinite(x))) return [n[0], n[1], n[2], n[3] ?? 1];
  }
  throw new Error(`not a colour: ${value}`);
}

/** `top` painted over an opaque `bottom`. */
function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1) as unknown as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A token, or a colour that may contain var(), resolved to a colour; layers listed top first, the last one opaque. */
function paint(tokens: Map<string, string>, layers: readonly string[]): Rgba {
  const colours = layers.map((l) => parseColor(resolve(tokens, l.startsWith('--') ? `var(${l})` : l)));
  let result = colours[colours.length - 1];
  if (result[3] !== 1) throw new Error(`bottom layer ${layers[layers.length - 1]} is not opaque`);
  for (let i = colours.length - 2; i >= 0; i -= 1) result = over(colours[i], result);
  return result;
}

interface Pair {
  readonly fg: string;
  /** Background layers, top first; the last must be opaque. */
  readonly bg: readonly string[];
  readonly min: number;
}

const TEXT = 4.5;
const LARGE = 3; // text of 24px and up, or bold 18.66px and up
const UI = 3;

const cross = (fgs: readonly string[], bgs: readonly (readonly string[])[], min: number): Pair[] =>
  fgs.flatMap((fg) => bgs.map((bg) => ({ fg, bg, min })));

/* Where text sits: the page, the cards and wells, the drawers. */
const SOLID_DARK = [['--bg-0'], ['--bg-1'], ['--surface-1'], ['--surface-2'], ['--surface-3']];
const SOLID_LIGHT = [['--bg-0'], ['--bg-1'], ['--surface-1'], ['--surface-2']];

/* Every text token, new and legacy name alike: a component may use either. */
const TEXT_TOKENS = [
  '--text-1', '--text-2', '--text-3', '--body-ink', '--cyan-text', '--amber-text',
  '--ok', '--err', '--info', '--syn-key',
  '--text-primary', '--text-secondary', '--text-tertiary', '--text-muted',
  '--accent-primary', '--accent-secondary', '--accent-tertiary', '--accent-quaternary',
  '--success', '--nav-link-text', '--nav-link-text-active', '--button-nav-text', '--cta-button-text',
  // The current page and section (header, More menu, rail) and the rail's labels.
  '--current-ink', '--rail-label',
  // Section and card titles, and the small amber labels that remain (status, warnings).
  '--title-ink', '--warn',
];
const HUES = ['--hue-violet', '--hue-teal', '--hue-green', '--hue-blue', '--hue-orange', '--hue-pink'];

/* Glass, worst case: a sharp, bright page glyph right behind the text, no credit for the blur. */
const GLASS_TEXT = ['--text-1', '--text-2', '--cyan-text', '--amber-text', '--current-ink'];

/* Large display text: the '#' before a title, metric figures. */
const DISPLAY = ['--amber-display', '--title-mark'];

/* Button text over the ghost tint (resting, then hover) and the filled
   primary, on the page and on a card. */
const BUTTON_PAIRS = (page: string): Pair[] => [
  ...cross(['--cyan-text'], [['rgba(var(--cyan-rgb), 0.1)', page], ['rgba(var(--cyan-rgb), 0.18)', page]], TEXT),
  { fg: '--on-cyan', bg: ['--cyan'], min: TEXT },
];

/* Amber highlights on a card: amber ink on its tint (metrics in project
   text), and the light theme's slate ink in an amber frame (skill tags). */
const AMBER_TINTS: Pair[] = [
  { fg: '--amber-text', bg: ['rgba(var(--amber-rgb), 0.15)', '--surface-1'], min: TEXT },
  { fg: '--amber-text', bg: ['rgba(var(--amber-rgb), 0.2)', '--surface-1'], min: TEXT },
  // A timeline card's type label: teal on its tint, on the header's cyan tint.
  { fg: '--hue-teal', bg: ['rgba(var(--hue-teal-rgb), 0.2)', 'rgba(var(--cyan-rgb), 0.08)', '--surface-1'], min: TEXT },
];

/* The rail sits straight on the page, the light theme's white body included. */
const RAIL_UI = ['--rail-tick', '--current-edge'];

const PAIRS: Record<Theme, Pair[]> = {
  dark: [
    ...cross(TEXT_TOKENS, SOLID_DARK, TEXT),
    ...cross(HUES, [['--bg-0'], ['--surface-1'], ['--surface-3']], TEXT),
    ...cross(GLASS_TEXT, [['--glass-fill', '--text-1'], ['--glass-fill', '--bg-0']], TEXT),
    ...cross(DISPLAY, SOLID_DARK, LARGE),
    ...BUTTON_PAIRS('--bg-0'),
    ...BUTTON_PAIRS('--surface-1'),
    ...AMBER_TINTS,
    // Hover and current-item tints.
    { fg: '--cyan-text', bg: ['rgba(var(--cyan-rgb), 0.18)', '--bg-0'], min: TEXT },
    { fg: '--nav-link-text-active', bg: ['--nav-link-bg-active', '--bg-0'], min: TEXT },
    // Text on the neon fills.
    { fg: '--on-cyan', bg: ['--cyan'], min: TEXT },
    { fg: '--on-amber', bg: ['--amber'], min: TEXT },
    { fg: '--text-on-accent-bg', bg: ['--accent-primary'], min: TEXT },
    { fg: '--text-on-accent-bg', bg: ['--accent-secondary'], min: TEXT },
    // UI parts.
    ...cross(['--border-strong'], [['--bg-0'], ['--surface-1'], ['--surface-2']], UI),
    ...cross(['--focus-ring', '--cyan-edge', '--amber-edge'], SOLID_DARK, UI),
    ...cross(RAIL_UI, SOLID_DARK, UI),
    // A header control's text over its resting and hover tints, on the page.
    ...cross(['--text-2', '--cyan-text', '--current-ink'], [['rgba(var(--cyan-rgb), 0.12)', '--bg-0']], TEXT),
  ],
  light: [
    ...cross(TEXT_TOKENS, SOLID_LIGHT, TEXT),
    ...cross(HUES, [['--bg-0'], ['--bg-1'], ['--surface-1']], TEXT),
    ...cross(GLASS_TEXT, [['--glass-fill', '--text-1'], ['--glass-fill', '--bg-0']], TEXT),
    ...cross(DISPLAY, SOLID_LIGHT, LARGE),
    ...BUTTON_PAIRS('--bg-0'),
    ...BUTTON_PAIRS('--surface-1'),
    ...AMBER_TINTS,
    { fg: '--text-1', bg: ['rgba(var(--amber-rgb), 0.2)', '--surface-1'], min: TEXT },
    { fg: '--cyan-text', bg: ['rgba(var(--cyan-rgb), 0.18)', '--surface-1'], min: TEXT },
    { fg: '--nav-link-text-active', bg: ['--nav-link-bg-active', '--bg-0'], min: TEXT },
    { fg: '--on-cyan', bg: ['--cyan'], min: TEXT },
    { fg: '--on-amber', bg: ['--amber'], min: TEXT },
    { fg: '--text-on-accent-bg', bg: ['--accent-primary'], min: TEXT },
    { fg: '--text-on-accent-bg', bg: ['--accent-secondary'], min: TEXT },
    ...cross(['--border-strong'], [['--bg-0'], ['--surface-1'], ['--surface-2']], UI),
    ...cross(['--focus-ring', '--cyan-edge', '--amber-edge'], SOLID_LIGHT, UI),
    ...cross(RAIL_UI, [...SOLID_LIGHT, ['#ffffff']], UI),
    ...cross(['--text-2', '--cyan-text', '--current-ink'], [['rgba(var(--cyan-rgb), 0.12)', '--surface-1']], TEXT),
  ],
};

describe('colour tokens meet WCAG AA', () => {
  for (const theme of ['dark', 'light'] as const) {
    it(`${theme} theme: every listed text and UI pair`, () => {
      const tokens = tokensFor(theme);
      const failures = PAIRS[theme]
        .map(({ fg, bg, min }) => ({ fg, bg, min, got: ratio(paint(tokens, [fg]), paint(tokens, bg)) }))
        .filter(({ got, min }) => got < min)
        .map(({ fg, bg, min, got }) => `${fg} on ${bg.join(' over ')}: ${got.toFixed(2)} < ${min}`);
      expect(PAIRS[theme].length).toBeGreaterThan(100);
      expect(failures).toEqual([]);
    });
  }

  it('the themes really differ (the parser picks up the light block)', () => {
    expect(resolve(tokensFor('dark'), 'var(--text-1)')).not.toBe(resolve(tokensFor('light'), 'var(--text-1)'));
    expect(resolve(tokensFor('light'), 'var(--accent-primary)')).toBe('#0b6780');
  });

  it('the known ratios come out right (the maths is WCAG 2.x)', () => {
    expect(ratio(parseColor('#000000'), parseColor('#ffffff'))).toBeCloseTo(21, 5);
    // Values from the visual spec: dark text-1 on bg-0, light cyan-text on white.
    expect(ratio(parseColor('#e6f1ff'), parseColor('#0a0f1c'))).toBeCloseTo(16.75, 1);
    expect(ratio(parseColor('#0b6780'), parseColor('#ffffff'))).toBeCloseTo(6.43, 1);
  });
});
