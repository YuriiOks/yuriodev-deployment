import { describe, expect, it } from 'vitest';
import { tagCategory, tagTone } from './tagTone';
import { timelineData } from '../data/timelineData';
import { skillsDataTyped } from '../services/skillsData';

describe('tagCategory', () => {
  it.each([
    ['RAG', 'ai'],
    ['Multi-Agent Systems', 'ai'],
    ['AWS', 'cloud'],
    ['ETL Pipelines', 'cloud'],
    ['Python', 'language'],
    ['FastAPI', 'language'],
    ['FinTech', 'domain'],
    ['GDPR', 'domain'],
    ['GitHub Actions', 'tools'],
    ['iOS', 'tools'],
    ['Mentoring', 'education'],
    ['Course Design', 'education'],
    ['Kubernetes', 'default'],
  ])('%s is %s', (label, category) => {
    expect(tagCategory(label)).toBe(category);
  });

  it('takes the first category that matches (the order of the lists)', () => {
    // "production ai" (ai) is checked before "pipelines" (cloud).
    expect(tagCategory('Production AI pipelines')).toBe('ai');
  });
});

describe('tagTone', () => {
  it.each([
    ['LangGraph', undefined, 'violet'],
    ['GCP', undefined, 'blue'],
    ['Swift', undefined, 'green'],
    ['Healthcare Analytics', undefined, 'orange'],
    ['CI/CD', undefined, 'amber'],
    ['Teaching', undefined, 'pink'],
    ['Something new', undefined, 'cyan'],
  ] as const)('label %s gives %s', (label, kind, tone) => {
    expect(tagTone(label, kind)).toBe(tone);
  });

  it.each([
    ['model', 'violet'],
    ['cloud', 'blue'],
    ['database', 'blue'],
    ['language', 'green'],
    ['framework', 'teal'],
    ['tool', 'amber'],
    ['metric', 'orange'],
    ['concept', 'pink'],
  ] as const)('an unmatched label of kind %s gives %s', (kind, tone) => {
    expect(tagTone('Zzz', kind)).toBe(tone);
  });

  it('the words in the label win over the kind', () => {
    expect(tagTone('Python', 'tool')).toBe('green');
  });

  it('a word shared by the timeline and the skills gets the same tone in both', () => {
    const timelineTags = new Set(timelineData.flatMap((event) => event.tags.map((tag) => tag.toLowerCase())));
    const skillTags = skillsDataTyped.flatMap((skill) => [
      ...skill.details.map((detail) => ({ label: detail.name, kind: detail.type })),
      { label: skill.highlight.text, kind: skill.highlight.type },
    ]);
    const shared = skillTags.filter(({ label }) => timelineTags.has(label.toLowerCase()));
    expect(shared.length).toBeGreaterThan(0);
    for (const { label, kind } of shared) {
      expect(tagTone(label, kind), label).toBe(tagTone(label));
    }
  });
});
