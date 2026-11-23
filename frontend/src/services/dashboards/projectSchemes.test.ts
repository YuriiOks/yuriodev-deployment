import { describe, expect, it } from 'vitest';
import { PROJECT_SCHEMES, projectScheme } from './projectSchemes';

describe('projectScheme', () => {
  it('is one of the four warm accents, and the same for the same id every time', () => {
    for (const id of ['garden', 'side-project', 'court-case', 'x', '']) {
      expect(PROJECT_SCHEMES).toContain(projectScheme(id));
      expect(projectScheme(id)).toBe(projectScheme(id));
    }
  });

  it('is pinned for known ids (a project must keep its colour across releases)', () => {
    expect(projectScheme('garden')).toBe('clay');
    expect(projectScheme('side-project')).toBe('saffron');
    expect(projectScheme('court-case')).toBe('gold');
    expect(['a', 'b', 'c', 'd', 'e', 'f'].map(projectScheme)).toEqual(['clay', 'ember', 'saffron', 'gold', 'clay', 'ember']);
  });

  it('uses every one of the four shades across ids, and never the three space schemes', () => {
    const used = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(projectScheme));
    expect(used.size).toBe(4);
    for (const scheme of PROJECT_SCHEMES) expect(['personal', 'work-1', 'work-2']).not.toContain(scheme);
  });
});
