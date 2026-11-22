import { describe, expect, it } from 'vitest';
import { DEFAULT_LANG, LANGS, STRINGS, isLang, pick } from './strings';

/** "a.b.c" for every string leaf of a nested object. */
function leaves(value: unknown, path = ''): string[] {
  if (typeof value === 'string') return [path];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, path ? `${path}.${key}` : key),
  );
}

function at(value: unknown, path: string): string {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], value) as string;
}

describe('dashboard strings', () => {
  it('Russian is the default, and there are two languages', () => {
    expect(DEFAULT_LANG).toBe('ru');
    expect([...LANGS]).toEqual(['ru', 'en']);
    expect(isLang('ru')).toBe(true);
    expect(isLang('en')).toBe(true);
    expect(isLang('de')).toBe(false);
    expect(isLang(null)).toBe(false);
  });

  it('both languages have every key, with the same structure', () => {
    const ru = leaves(STRINGS.ru).sort();
    const en = leaves(STRINGS.en).sort();
    expect(ru.length).toBeGreaterThan(40);
    expect(ru).toEqual(en);
  });

  it('no text is empty', () => {
    for (const lang of LANGS) {
      for (const key of leaves(STRINGS[lang])) expect(at(STRINGS[lang], key).trim(), `${lang}.${key}`).not.toBe('');
    }
  });

  it('the languages differ where they should (the words, not just the brand names)', () => {
    const same = leaves(STRINGS.ru).filter((key) => at(STRINGS.ru, key) === at(STRINGS.en, key));
    // Tool names (GitHub, Slack ...) are the same in both; the sentences are not.
    expect(same.every((key) => key.startsWith('tabs.'))).toBe(true);
    expect(STRINGS.ru.countdownMin).not.toBe(STRINGS.en.countdownMin);
  });

  it('pick returns the text in the language asked for', () => {
    expect(pick({ ru: 'да', en: 'yes' }, 'ru')).toBe('да');
    expect(pick({ ru: 'да', en: 'yes' }, 'en')).toBe('yes');
  });
});
