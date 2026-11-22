import { describe, expect, it } from 'vitest';

// The private dashboards' design rules (the "calm tool" brief), held in their own stylesheets so they cannot
// drift back: three weights, no capitals, five type steps, the dashboards' interface face, spacing from one
// scale, no coloured shadows, no gradients and glows outside the shell's page layer.
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

  it('uses weights 400, 500 and 600 only, as numbers', () => {
    expect(declarations('font-weight', (value) => /^(400|500|600)$/.test(value))).toEqual([]);
  });

  it('has no capitals and no tracking except the two negative ones', () => {
    expect(find(/text-transform\s*:\s*uppercase/)).toEqual([]);
    expect(declarations('letter-spacing', (value) => /^-0\.0[12]em$/.test(value))).toEqual([]);
  });

  it('sets type from the five --dash-fs-* steps, never clamp() or a site size token', () => {
    expect(declarations('font-size', (value) => /^(var\(--dash-fs-(meta|ui|title|page|stat)\)|inherit)$/.test(value))).toEqual([]);
    expect(find(/clamp\(/)).toEqual([]);
    expect(find(/var\(--fs-/)).toEqual([]);
  });

  it('uses the dashboards face, and the mono only through .dashNum', () => {
    expect(
      declarations('font-family', (value, file) => value === 'var(--dash-font-ui)' || file.endsWith('dashboard-fonts.css') || file.endsWith('dashboard-type.module.css')),
    ).toEqual([]);
    expect(find(/var\(--font-mono\)/, (file) => file.endsWith('dashboard-type.module.css'))).toEqual([]);
  });

  it('has no text shadow, and no space colour in a shadow', () => {
    expect(find(/text-shadow/)).toEqual([]);
    expect(find(/box-shadow[^;]*(--dash-accent|--dash-fill|--dash-ink-|--dash-glow)/)).toEqual([]);
  });

  it('spaces padding, margin and gap from the 4/8/12/16/24/32px scale (and a 2px hairline step)', () => {
    const allowed = new Set(['0', '0.125', '0.25', '0.5', '0.75', '1', '1.5', '2']);
    // Two measured exceptions: the event block's 10px left padding (a 3px bar plus 7px of air), and the tab row's
    // end padding that holds the scroll fade.
    const exceptions = ['0.625rem', '3.5rem 0 0.125rem'];
    expect(
      declarations('(?:padding|margin|gap|row-gap|column-gap)[\\w-]*', (value) => {
        if (exceptions.some((e) => value.includes(e))) return true;
        const rems = [...value.matchAll(/(-?\d*\.?\d+)rem/g)].map((m) => String(Math.abs(Number(m[1]))));
        return rems.every((rem) => allowed.has(rem));
      }),
    ).toEqual([]);
  });

  it('uses only the three dashboards radii (or a circle, or a fixed fraction of one)', () => {
    expect(
      declarations('border-radius', (value) =>
        /^(var\(--dash-r-(surface|control|tag)\)|var\(--radius-(round|pill)\)|inherit|0|calc\(var\(--dash-r-control\) - 0\.125rem\))$/.test(value),
      ),
    ).toEqual([]);
  });

  it('keeps the glows to the shell: radial gradients appear nowhere else', () => {
    expect(find(/radial-gradient/, (file) => file.includes('DashboardShell.module.css'))).toEqual([]);
  });
});
