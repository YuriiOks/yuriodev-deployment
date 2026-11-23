import { describe, expect, it } from 'vitest';
import { ICON_KEY_PATTERN, PROJECT_ICON_KEYS, isProjectIconKey, parseIconKey } from './projectIcons';
import { STRINGS } from './strings';

describe('project icon keys', () => {
  it('are at least sixteen, each a valid server key, none twice', () => {
    expect(PROJECT_ICON_KEYS.length).toBeGreaterThanOrEqual(16);
    for (const key of PROJECT_ICON_KEYS) expect(key).toMatch(ICON_KEY_PATTERN);
    expect(new Set(PROJECT_ICON_KEYS).size).toBe(PROJECT_ICON_KEYS.length);
    for (const key of ['scales', 'gavel', 'bulb', 'spark', 'rocket', 'home', 'heart', 'book', 'briefcase', 'globe', 'camera', 'code', 'wallet', 'plane', 'leaf', 'flag']) {
      expect(PROJECT_ICON_KEYS).toContain(key);
    }
  });

  it('read a server value as a key or as none', () => {
    expect(parseIconKey('scales')).toBe('scales');
    expect(parseIconKey('a-1')).toBe('a-1');
    for (const bad of [undefined, null, '', 'Scales', 'a b', 'x'.repeat(25), 3]) expect(parseIconKey(bad)).toBeNull();
  });

  it('tell a key we draw from one we do not (that one shows the letter)', () => {
    expect(isProjectIconKey('rocket')).toBe(true);
    expect(isProjectIconKey('some-future-icon')).toBe(false);
    expect(isProjectIconKey(null)).toBe(false);
  });

  it('have a name in both languages', () => {
    for (const lang of ['ru', 'en'] as const) {
      for (const key of PROJECT_ICON_KEYS) expect(STRINGS[lang].projectIcons[key].trim(), `${lang}.${key}`).not.toBe('');
    }
  });
});
