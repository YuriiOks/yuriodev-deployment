import { describe, expect, it } from 'vitest';
import { BREAKPOINTS } from '../../constants/breakpoints';

// Every stylesheet's @media widths come from one scale (documented in
// _variables.css): 30/48/64/80/88/100rem for "from X up", X - 0.01rem for "below X".
const styles = import.meta.glob('/src/**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const SCALE = Object.values(BREAKPOINTS);
const ALLOWED = new Set(SCALE.flatMap((rem) => [`${rem}rem`, `${(rem - 0.01).toFixed(2)}rem`]));

/**
 * Section and widget stylesheets still on their original pixel widths. They
 * move onto the scale with the section layout work; a file leaves this list
 * as soon as it is migrated (the second test insists).
 */
const NOT_YET_ON_SCALE = new Set([
  '/src/components/sections/AboutSection/AboutSection.module.css',
  '/src/components/sections/ComingSoonSection/ComingSoonSection.module.css',
  '/src/components/sections/ConnectSection/ConnectSection.module.css',
  '/src/components/sections/PlatformSection/PlatformSection.module.css',
  '/src/components/sections/ProjectsSection/ProjectsSection.module.css',
  '/src/components/sections/SkillsSection/SkillsSection.module.css',
  '/src/components/sections/TimelineSection/TimelineItem.module.css',
  '/src/components/sections/TimelineSection/TimelineSection.module.css',
  '/src/components/ui/InteractiveTerminal/InteractiveTerminal.module.css',
  '/src/components/ui/LoadingScreen/LoadingScreen.module.css',
  '/src/components/ui/ProjectCard/ProjectCard.module.css',
  '/src/components/ui/SkillTerminal/SkillTerminal.module.css',
  '/src/pages/text-page.module.css',
]);

/** "file:line: value" for every @media width in `text` that is off the scale. */
function offScale(file: string, text: string): string[] {
  const found: string[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.includes('@media')) return;
    for (const m of line.matchAll(/(?:min|max)-width\s*:\s*([\d.]+[a-z]+)/g)) {
      if (!ALLOWED.has(m[1])) found.push(`${file}:${i + 1}: ${m[1]}`);
    }
  });
  return found;
}

describe('breakpoint scale', () => {
  it('matches the documented scale', () => {
    expect(BREAKPOINTS).toEqual({ sm: 30, md: 48, lg: 64, xl: 80, sidebar: 88, wide: 100 });
  });

  it('every @media width outside the not-yet-migrated files is on the scale', () => {
    const found = Object.entries(styles)
      .filter(([file]) => !NOT_YET_ON_SCALE.has(file))
      .flatMap(([file, text]) => offScale(file, text));
    expect(Object.keys(styles).length).toBeGreaterThan(10);
    expect(found).toEqual([]);
  });

  it('lists only files that exist and still need migrating', () => {
    for (const file of NOT_YET_ON_SCALE) {
      expect(styles[file], file).toBeDefined();
      expect(offScale(file, styles[file]).length, file).toBeGreaterThan(0);
    }
  });

  it('the layout chrome is on the scale', () => {
    for (const chrome of ['Header', 'SectionRail', 'Footer', 'PageLayout']) {
      const file = `/src/components/layout/${chrome}/${chrome}.module.css`;
      expect(styles[file], file).toBeDefined();
      expect(NOT_YET_ON_SCALE.has(file)).toBe(false);
    }
  });
});
