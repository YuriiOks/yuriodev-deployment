import { describe, expect, it } from 'vitest';
import { EMAILS, IDENTITY, PROJECT_LINKS, SOCIALS, displayUrl } from './data/site';

// Every source file (tests excluded: they may pin expected values), as text.
const sources = Object.fromEntries(
  Object.entries(
    import.meta.glob(['/src/**/*.{ts,tsx,css}', '!/src/**/*.test.{ts,tsx}'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ).filter(([file]) => file !== '/src/data/site.ts'),
);

/** Case-insensitive needles: each profile and project URL as typed (so "x.com/YuriODev" counts too), and each address. */
const needles = [
  ...SOCIALS.map(({ url }) => displayUrl(url)),
  ...Object.values(PROJECT_LINKS).map(displayUrl),
  ...Object.values(EMAILS),
  IDENTITY.website,
].map((needle) => needle.toLowerCase());

describe('one source for identity and links', () => {
  it('no profile URL, project link, address or site origin is copied outside data/site.ts', () => {
    const copies: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      text.split('\n').forEach((line, i) => {
        const lower = line.toLowerCase();
        for (const needle of needles) {
          if (lower.includes(needle)) copies.push(`${file}:${i + 1}: ${needle}`);
        }
      });
    }
    expect(Object.keys(sources).length).toBeGreaterThan(40);
    expect(copies).toEqual([]);
  });

  it('no component keeps its own list of the home page sections', () => {
    // A copy shows up as several section ids quoted in one file (a section's
    // own id="..." attribute does not count).
    const ids = ['hero', 'about', 'timeline', 'skills', 'projects', 'platform', 'connect'];
    const lists: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      if (!/\.tsx?$/.test(file)) continue;
      const quoted = ids.filter((id) => new RegExp(`(?<!id=)['"\`]#?${id}['"\`]`).test(text));
      if (quoted.length >= 3) lists.push(`${file}: ${quoted.join(', ')}`);
    }
    expect(lists).toEqual([]);
  });
});
