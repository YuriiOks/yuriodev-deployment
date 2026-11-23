import { describe, expect, it } from 'vitest';
import { promptPlace, promptSlug } from './promptPlace';

const names = {
  spaceName: (space: string) => ({ personal: 'Personal', 'work-1': 'Acme Corp', 'work-2': 'Work 2' })[space as 'personal'] ?? space,
  projectName: (id: string) => ({ garden: 'Garden', 'side-project': 'Side Project!' })[id as 'garden'],
};

describe('promptSlug', () => {
  it('lower-cases and joins words with dashes, keeps letters of any script, and cuts at 24', () => {
    expect(promptSlug('Side project')).toBe('side-project');
    expect(promptSlug('  Acme  Corp! ')).toBe('acme-corp');
    expect(promptSlug('Суд и бумаги')).toBe('суд-и-бумаги');
    expect(promptSlug('a'.repeat(40))).toHaveLength(24);
    expect(promptSlug('!!!')).toBe('');
  });
});

describe('promptPlace', () => {
  it('names the page the prompt runs', () => {
    expect(promptPlace('/dashboards', names)).toBe('dashboards');
    expect(promptPlace('/dashboards/', names)).toBe('dashboards');
    expect(promptPlace('/dashboards/calendar', names)).toBe('dashboards/calendar');
  });

  it('uses the name a space is shown by, not its slug', () => {
    expect(promptPlace('/dashboards/personal', names)).toBe('dashboards/personal');
    expect(promptPlace('/dashboards/work-1', names)).toBe('dashboards/acme-corp');
    expect(promptPlace('/dashboards/work-2', names)).toBe('dashboards/work-2');
  });

  it('uses a project\'s name when it is known, its id otherwise', () => {
    expect(promptPlace('/dashboards/projects/garden', names)).toBe('dashboards/projects/garden');
    expect(promptPlace('/dashboards/projects/side-project', names)).toBe('dashboards/projects/side-project');
    expect(promptPlace('/dashboards/projects/unknown-id', names)).toBe('dashboards/projects/unknown-id');
    expect(promptPlace('/dashboards/projects/a%20b', names)).toBe('dashboards/projects/a-b');
  });
});
