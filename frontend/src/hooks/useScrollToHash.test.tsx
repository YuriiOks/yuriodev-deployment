import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useScrollToHash } from './useScrollToHash';
import { noteJump } from '../utils/scroll';

function Page() {
  useScrollToHash();
  return (
    <>
      <section id="about">About</section>
      <section id="skills">Skills</section>
    </>
  );
}

let resolveFonts: () => void = () => {};

function mockFonts(status: 'loading' | 'loaded') {
  const ready = new Promise<void>((resolve) => {
    resolveFonts = resolve;
  });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { status, ready } });
}

function openAt(hash: string) {
  const scrolled: string[] = [];
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
    scrolled.push(this.id);
  });
  render(
    <MemoryRouter initialEntries={[`/${hash}`]}>
      <Page />
    </MemoryRouter>,
  );
  return scrolled;
}

beforeEach(() => {
  resolveFonts = () => {};
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'fonts');
});

describe('useScrollToHash', () => {
  it('jumps to the fragment once when the fonts are already in', async () => {
    mockFonts('loaded');
    const scrolled = openAt('#skills');
    await act(async () => resolveFonts());
    expect(scrolled).toEqual(['skills']);
  });

  it('jumps again once a late web font has reflowed the page', async () => {
    mockFonts('loading');
    const scrolled = openAt('#skills');
    expect(scrolled).toEqual(['skills']);
    await act(async () => resolveFonts());
    expect(scrolled).toEqual(['skills', 'skills']);
  });

  it('does not jump back when another jump was asked for meanwhile', async () => {
    mockFonts('loading');
    const scrolled = openAt('#skills');
    noteJump('about');
    await act(async () => resolveFonts());
    expect(scrolled).toEqual(['skills']);
  });

  it.each(['wheel', 'touchstart', 'keydown', 'pointerdown'])(
    'does not pull the visitor back after a %s before the font is in',
    async (type) => {
      mockFonts('loading');
      const scrolled = openAt('#skills');
      window.dispatchEvent(new Event(type));
      await act(async () => resolveFonts());
      expect(scrolled).toEqual(['skills']);
    },
  );

  it('stops listening for input once the font is in', async () => {
    mockFonts('loading');
    const remove = vi.spyOn(window, 'removeEventListener');
    openAt('#skills');
    await act(async () => resolveFonts());
    const removed = remove.mock.calls.map(([type]) => type);
    expect(removed).toEqual(expect.arrayContaining(['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown']));
  });

  it('does nothing without a fragment', async () => {
    mockFonts('loading');
    const scrolled = openAt('');
    await act(async () => resolveFonts());
    expect(scrolled).toEqual([]);
  });
});
