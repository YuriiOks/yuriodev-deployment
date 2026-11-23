import { describe, expect, it } from 'vitest';
import { PROJECT_SCHEMES, projectScheme } from './projectSchemes';

describe('projectScheme', () => {
  it('is one of the five accents, and the same for the same id every time', () => {
    for (const id of ['garden', 'side-project', 'court-case', 'x', '']) {
      expect(PROJECT_SCHEMES).toContain(projectScheme(id));
      expect(projectScheme(id)).toBe(projectScheme(id));
    }
  });

  it('is pinned for known ids (a project must keep its colour across releases)', () => {
    expect(projectScheme('garden')).toBe('slate');
    expect(projectScheme('side-project')).toBe('pink');
    expect(projectScheme('court-case')).toBe('pink');
    expect(['a', 'b', 'c', 'd', 'e', 'f'].map(projectScheme)).toEqual(['green', 'pink', 'blue', 'blue', 'slate', 'amber']);
  });

  it('uses more than one accent across ids, and never the three space schemes', () => {
    const used = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(projectScheme));
    expect(used.size).toBeGreaterThan(3);
    for (const scheme of PROJECT_SCHEMES) expect(['personal', 'work-1', 'work-2']).not.toContain(scheme);
  });
});
