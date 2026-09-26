import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../context/ThemeContext';
import Portfolio from '../pages/portfolio';
import {
  EMAILS,
  IDENTITY,
  PAGES,
  PROJECT_LINKS,
  SECTIONS,
  SHORTCUTS,
  SOCIALS,
  displayUrl,
  pageAt,
  shortcutFor,
  socialsFor,
} from './site';

const allUrls = [IDENTITY.website, ...SOCIALS.map(({ url }) => url), ...Object.values(PROJECT_LINKS)];

describe('site config', () => {
  it('has unique ids in every list', () => {
    for (const list of [SECTIONS, PAGES, SOCIALS, SHORTCUTS]) {
      const ids = list.map(({ id }) => id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const paths = PAGES.map(({ path }) => path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('links only over https', () => {
    for (const url of allUrls) expect(new URL(url).protocol, url).toBe('https:');
  });

  it('keeps the LinkedIn and X profiles the social feed posts from', () => {
    expect(SOCIALS.find(({ id }) => id === 'linkedin')?.url).toBe('https://www.linkedin.com/in/y-oks');
    expect(SOCIALS.find(({ id }) => id === 'x')?.url).toBe('https://x.com/YuriODev');
  });

  it('spells the YuriODev GitHub account with its own casing', () => {
    expect(PROJECT_LINKS.pythonCourse).toBe('https://github.com/YuriODev/Python-Course');
    expect(SOCIALS.find(({ id }) => id === 'github-yuriodev')?.url).toBe('https://github.com/YuriODev');
  });

  it('keeps both addresses on the site domain', () => {
    expect(EMAILS.personal).toBe('yurii.oksamytnyi@yuriodev.co.uk');
    expect(EMAILS.contact).toBe('contact@yuriodev.co.uk');
  });

  it('lists the sections in the order the home page renders them', () => {
    const { container } = render(
      <ThemeProvider>
        <MemoryRouter>
          <Portfolio />
        </MemoryRouter>
      </ThemeProvider>,
    );
    const rendered = [...container.children].filter((el) => el.tagName === 'SECTION').map((el) => el.id);
    expect(rendered).toEqual(SECTIONS.filter((section) => !section.optional).map(({ id }) => id));
  });
});

describe('social placements', () => {
  it('footer: LinkedIn and X first, and a single GitHub icon (YuriiOks)', () => {
    const footer = socialsFor('footer');
    expect(footer.slice(0, 2).map(({ id }) => id)).toEqual(['linkedin', 'x']);
    const github = footer.filter(({ icon }) => icon === 'github');
    expect(github.map(({ url }) => url)).toEqual(['https://github.com/YuriiOks']);
  });

  it('connect: both GitHub accounts, the second one labelled as YuriODev', () => {
    const connect = socialsFor('connect');
    expect(connect.slice(0, 2).map(({ id }) => id)).toEqual(['linkedin', 'x']);
    expect(connect.find(({ id }) => id === 'github-yuriodev')?.label).toBe('GitHub (YuriODev)');
    expect(connect.some(({ id }) => id === 'github')).toBe(true);
  });

  it('every profile the site linked before is still linked somewhere', () => {
    const linked = new Set(SOCIALS.filter(({ placements }) => placements.length > 0).map(({ url }) => url));
    for (const url of [
      'https://github.com/YuriODev',
      'https://github.com/YuriiOks',
      'https://www.linkedin.com/in/y-oks',
      'https://discord.gg/2UK3cKDd2s',
      'https://x.com/YuriODev',
      'https://medium.com/@YuriODev',
      'https://www.instagram.com/yuriodev/',
      'https://www.threads.com/yuriodev/',
      'https://twitch.com/YuriODev',
      'https://patreon.com/YuriODev',
      'https://buymeacoffee.com/yuriodev',
    ]) {
      expect(linked.has(url), url).toBe(true);
    }
  });
});

describe('helpers', () => {
  it('displayUrl drops the scheme, www. and a trailing slash', () => {
    expect(displayUrl('https://www.linkedin.com/in/y-oks')).toBe('linkedin.com/in/y-oks');
    expect(displayUrl('https://www.threads.com/yuriodev/')).toBe('threads.com/yuriodev');
  });

  it('pageAt ignores a trailing slash and knows only real pages', () => {
    expect(pageAt('/')?.id).toBe('portfolio');
    expect(pageAt('/privacy/')?.id).toBe('privacy');
    expect(pageAt('/nope')).toBeUndefined();
  });

  it('shortcutFor: Ctrl/Cmd+K is the palette, bare K is the previous section', () => {
    const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) =>
      shortcutFor({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });
    expect(key('k', { ctrlKey: true })).toBe('palette');
    expect(key('k', { metaKey: true })).toBe('palette');
    expect(key('k')).toBe('prev');
    expect(key('J')).toBe('next');
    expect(key('?')).toBe('help');
    expect(key('t', { altKey: true })).toBeNull();
    expect(key('j', { ctrlKey: true })).toBeNull();
    expect(key('x')).toBeNull();
  });
});
