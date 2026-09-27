import { describe, expect, it } from 'vitest';

/**
 * Guards against pictographic emoji creeping back into the UI or terminal
 * text: the site uses Lucide icons (components/ui/Icon, components/ui/IconChip)
 * instead. A handful of typographic symbols stay text on purpose and are
 * allowed through: '→' in prose and CSS comments, '↑'/'↓' inside <kbd> hints,
 * and the terminal's own output markers '✓'/'✗'/'⚠' (the hero's terminal
 * card and InteractiveTerminal.module.css's ::before content) plus its
 * header markers '◆'/'▸'/'»' (utils/headerMarker.ts). Of that list, only '⚠'
 * carries the Extended_Pictographic property, so it is the one glyph from it
 * in ALLOWED below; the rest never match the pattern in the first place.
 * Also allowed: a handful of pre-existing, already-monochrome UI glyphs that
 * Unicode happens to classify as Extended_Pictographic too, despite reading
 * as plain typography rather than emoji - '©' (Footer), '▶'/'▪' (expand/
 * collapse carets, the boot screen's loading squares) and 'ℹ' (a string this
 * file's own line-colouring compares against, not rendered emoji).
 *
 * Commented-out code (retired project entries in services/projectsData.ts,
 * the unmounted Features/Stats blocks in PlatformSection.tsx) is allowed to
 * keep its old emoji rather than being rewritten for no runtime effect, so
 * both block comments and whole-line `//` comments are stripped before the
 * scan; a real, working file never needs an emoji inside a comment to pass.
 */
const PICTOGRAPHIC = /\p{Extended_Pictographic}/gu;
const ALLOWED = new Set(['⚠', '©', '▶', '▪', 'ℹ']);

const files = import.meta.glob('/src/**/*.{ts,tsx,css}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Block comments everywhere, plus whole-line `//` comments outside CSS
 * (CSS has no `//` syntax, and stripping it there would also eat `https://`
 * inside a real declaration). Comments that share a line with real code are
 * deliberately left alone: an emoji trailing live code should still fail. */
function stripComments(file: string, text: string): string {
  const noBlocks = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return file.endsWith('.css') ? noBlocks : noBlocks.replace(/^\s*\/\/.*$/gm, '');
}

/** "file:line: text" for every disallowed pictographic emoji found. */
function offenders(): string[] {
  const found: string[] = [];
  for (const [file, raw] of Object.entries(files)) {
    if (/\.test\.tsx?$/.test(file)) continue;
    stripComments(file, raw)
      .split('\n')
      .forEach((line, i) => {
        const matches = line.match(PICTOGRAPHIC);
        if (matches?.some((m) => !ALLOWED.has(m))) found.push(`${file}:${i + 1}: ${line.trim()}`);
      });
  }
  return found;
}

describe('no pictographic emoji outside tests', () => {
  it('has files to check (glob sanity)', () => {
    expect(Object.keys(files).length).toBeGreaterThan(10);
  });

  it('contains no pictographic emoji in UI or terminal text', () => {
    expect(offenders()).toEqual([]);
  });
});
