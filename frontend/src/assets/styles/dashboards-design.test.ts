import { describe, expect, it } from 'vitest';

// The private dashboards' look: they wear the platform (the approved mockup). Fira Code throughout, the site's navy
// night and pale day with cyan line work and amber headings, soft colour glows on the page and glass panels over
// them; each space is a skin of that (Personal the site's own palette, Work 1 violet, Work 2 red with black and
// white). These rules hold it in their own stylesheets so it cannot drift: one face, five type steps, weights 400 to
// 700, spacing from one scale, three radii and the pill, colour only through the --dash-* tokens (so every pair stays
// under contrast.test.ts), shadows only from tokens, glass only through the recipe, one set of glows.
const all = import.meta.glob('/src/**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.entries(all).filter(
  ([file]) =>
    file.includes('/components/dashboards/') || file.includes('/pages/dashboard') || file.includes('/assets/styles/dashboard-'),
);

/** "file:line: text" for every declaration of `prop` (a RegExp source) whose value fails `ok`. */
function declarations(prop: string, ok: (value: string, file: string, line: string) => boolean): string[] {
  const out: string[] = [];
  const re = new RegExp(`^\\s*(?:${prop})\\s*:\\s*([^;]*);?\\s*$`);
  for (const [file, text] of files) {
    text.split('\n').forEach((line, i) => {
      const m = re.exec(line);
      if (m && !ok(m[1].trim(), file, line)) out.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

/** "file:line: text" for every non-comment line that matches. */
function find(pattern: RegExp, skip?: (file: string, line: string) => boolean): string[] {
  const out: string[] = [];
  for (const [file, text] of files) {
    text.split('\n').forEach((line, i) => {
      if (/^\s*(\/\*|\*)/.test(line)) return; // comments
      if (pattern.test(line) && !skip?.(file, line)) out.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

describe('dashboards design rules', () => {
  it('has stylesheets to check', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it('uses weights 400 to 700, as numbers', () => {
    expect(declarations('font-weight', (value) => /^(400|500|600|700)$/.test(value))).toEqual([]);
  });

  it('has no capitals and no tracking except the one negative one', () => {
    expect(find(/text-transform\s*:\s*uppercase/)).toEqual([]);
    expect(declarations('letter-spacing', (value) => /^-0\.0[12]em$/.test(value))).toEqual([]);
  });

  it('sets type from the five --dash-fs-* steps, never clamp() or a site size token', () => {
    expect(declarations('font-size', (value) => /^(var\(--dash-fs-(meta|ui|title|page|stat)\)|var\(--tile-font, var\(--dash-fs-ui\)\)|inherit)$/.test(value))).toEqual([]);
    expect(find(/clamp\(/)).toEqual([]);
    expect(find(/var\(--fs-/)).toEqual([]);
  });

  it('uses one face: the platform\'s Fira Code, through --dash-font-ui or --font-mono, never a named font', () => {
    expect(declarations('font-family', (value) => /^var\(--(dash-font-ui|font-mono)\)$/.test(value))).toEqual([]);
    expect(find(/@font-face/)).toEqual([]);
  });

  it('draws shadows only from the skin\'s tokens (the glass shadow, the glow), and no text shadow', () => {
    expect(find(/text-shadow/)).toEqual([]);
    // A box shadow names a token, or is an inset hairline or bar (an event's ink bar and ring), or a list that starts on the next line.
    expect(
      declarations('box-shadow', (value) => value === '' || /^(var\(--dash-(glass-shadow|glow-shadow)\)|none)$/.test(value) || /inset/.test(value)),
    ).toEqual([]);
  });

  it('spaces padding, margin and gap from the 4/8/12/16/24/32px scale (and a 2px and 3px hairline step)', () => {
    const allowed = new Set(['0', '0.125', '0.1875', '0.25', '0.5', '0.75', '1', '1.5', '2']);
    // Two measured exceptions: the event block's 10px left padding (a 3px bar plus 7px of air), and the tab row's
    // end padding that holds the scroll fade.
    const exceptions = ['0.625rem', '3.5rem'];
    expect(
      declarations('(?:padding|margin|gap|row-gap|column-gap)[\\w-]*', (value) => {
        if (exceptions.some((e) => value.includes(e))) return true;
        const rems = [...value.matchAll(/(-?\d*\.?\d+)rem/g)].map((m) => String(Math.abs(Number(m[1]))));
        return rems.every((rem) => allowed.has(rem));
      }),
    ).toEqual([]);
  });

  it('uses only the three radii and the pill (or a circle, or a fixed fraction of one)', () => {
    expect(
      declarations('border-radius', (value) =>
        /^(var\(--dash-r-(surface|control|tag)\)|var\(--tile-radius, var\(--dash-r-control\)\)|var\(--radius-(round|pill)\)|inherit|0)$/.test(value),
      ),
    ).toEqual([]);
  });

  it('takes colour only from the tokens: no hex or rgb literal in a dashboards stylesheet (one white plate for brand icons aside)', () => {
    expect(
      find(/#[0-9a-fA-F]{3,8}\b|\brgba?\((?!var\()/, (file, line) => file.endsWith('SpaceTile.module.css') && /#ffffff/.test(line)),
    ).toEqual([]);
  });

  it('keeps the page glows to the shell: radial gradients appear nowhere else', () => {
    expect(find(/radial-gradient/, (file) => file.includes('DashboardShell.module.css'))).toEqual([]);
  });

  it('keeps every card and panel flat: one tint, no gradient wash between two colours (only repeating hatches, masks and the page glows)', () => {
    expect(find(/(?<!repeating-)(?<!radial-)linear-gradient\(/, (_file, line) => /mask-image/.test(line))).toEqual([]);
  });

  it('makes glass only through the recipe: no backdrop-filter outside recipes.module.css (design-budget.test.ts) and no own glass fill', () => {
    expect(find(/backdrop-filter/)).toEqual([]);
    expect(find(/background(-color)?\s*:\s*var\(--dash-glass\)/)).toEqual([]);
  });

  it('reads the hub\'s per-card tint tokens (--hub-*) only in the hub\'s header and cards', () => {
    const hub = ['/HubHeader/', '/SpaceCard/', '/ProjectCards/', '/ProjectTile/'];
    expect(find(/var\(--hub-/, (file) => hub.some((part) => file.includes(part)))).toEqual([]);
  });
});
