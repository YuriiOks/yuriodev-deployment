import type { SkillTagType } from '../services/skillsData';

/** The colours a tag (ui/Chip) can take. cyan is the default, neutral is grey. */
export type Tone = 'cyan' | 'violet' | 'teal' | 'green' | 'blue' | 'amber' | 'orange' | 'pink' | 'neutral';

/** What a free-text tag (a timeline tag, a project's tech) is about. */
export type TagCategory = 'ai' | 'cloud' | 'language' | 'domain' | 'tools' | 'education' | 'default';

/**
 * Words that put a tag in a category, checked in this order: the first
 * category with a word found in the tag (whole words, case-insensitive) wins.
 */
const CATEGORY_TERMS: ReadonlyArray<readonly [Exclude<TagCategory, 'default'>, readonly string[]]> = [
  ['ai', ['rag', 'langgraph', 'mcp', 'llms', 'ai', 'ml models', 'mlops', 'pytorch', 'machine learning', 'deep learning',
    'nlp', 'computer vision', 'chromadb', 'multi-agent systems', 'production ai', 'prompt engineering']],
  ['cloud', ['aws', 'gcp', 'cloud', 'etl', 'pipelines', 'real-time systems', 'performance optimization']],
  ['language', ['python', 'swift', 'objective-c', 'c++', 'sql', 'fastapi']],
  ['domain', ['healthcare', 'fintech', 'financial', 'fraud detection', 'privacy engineering', 'gdpr', 'time series',
    'predictive analytics']],
  ['tools', ['ios', 'uikit', 'core data', 'rest apis', 'github actions', 'ci/cd', 'open source', 'sales automation']],
  ['education', ['education', 'teaching', 'mentoring', 'course design', 'academic', 'algorithms', 'data structures',
    'systems programming', 'competitive programming']],
];

/**
 * One pattern per category. A term matches only as a whole word, so 'ai'
 * finds "Production AI" but not "Tailwind" or "LangChain", and 'sql' finds
 * "SQL" but not "PostgreSQL".
 */
const CATEGORY_PATTERNS: ReadonlyArray<readonly [Exclude<TagCategory, 'default'>, RegExp]> = CATEGORY_TERMS.map(
  ([category, terms]) => {
    const alternatives = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|');
    return [category, new RegExp(`(?<![a-z0-9])(?:${alternatives})(?![a-z0-9])`)] as const;
  },
);

/** The category of a free-text tag, from the words it contains; 'default' when none matches. */
export function tagCategory(label: string): TagCategory {
  const lower = label.toLowerCase();
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(lower)) return category;
  }
  return 'default';
}

const CATEGORY_TONE: Record<TagCategory, Tone> = {
  ai: 'violet',
  cloud: 'blue',
  language: 'green',
  domain: 'orange',
  tools: 'amber',
  education: 'pink',
  default: 'cyan',
};

const KIND_TONE: Record<SkillTagType, Tone> = {
  model: 'violet',
  cloud: 'blue',
  database: 'blue',
  language: 'green',
  framework: 'teal',
  tool: 'amber',
  metric: 'orange',
  concept: 'pink',
};

/**
 * The one tone for a tag. The words in the label decide first, so the same
 * word gets the same colour wherever it appears (a timeline tag or a skill);
 * a label no word matches falls back to its skill kind, if it has one, and
 * then to cyan.
 */
export function tagTone(label: string, kind?: SkillTagType): Tone {
  const category = tagCategory(label);
  if (category !== 'default') return CATEGORY_TONE[category];
  return kind ? KIND_TONE[kind] : CATEGORY_TONE.default;
}
