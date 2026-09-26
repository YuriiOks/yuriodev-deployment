import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import HeroSection from './HeroSection';
import buttonStyles from '../../ui/Button/Button.module.css';
import { HERO_MESSAGES, messagesForScreenReaders, typewriterWidth } from './typewriter';
import { EMAILS } from '../../../data/site';

function mockReducedMotion(reduced: boolean) {
  const original = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  return () => {
    window.matchMedia = original;
  };
}

describe('typewriter box', () => {
  it('is as wide as the longest line plus room for the caret, in ch', () => {
    const longest = Math.max(...HERO_MESSAGES.map((message) => [...message].length));
    expect(typewriterWidth(HERO_MESSAGES)).toBe(`${longest + 2}ch`);
    expect(typewriterWidth(['ab', 'abcd', 'a'])).toBe('6ch');
    // '×' is one character, not a byte count.
    expect(typewriterWidth(['×50'])).toBe('5ch');
  });

  it('gives screen readers every line once, as sentences', () => {
    expect(messagesForScreenReaders(['One...', 'Two...'])).toBe('One. Two.');
  });
});

describe('HeroSection', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
    vi.useRealTimers();
  });

  it('keeps the typewriter at one fixed width while it types, hidden from screen readers', () => {
    vi.useFakeTimers();
    const { container } = render(<HeroSection />);
    const box = container.querySelector<HTMLElement>('#typewriter')!;
    expect(box).toHaveAttribute('aria-hidden', 'true');
    const width = box.style.getPropertyValue('--typewriter-width');
    expect(width).toBe(typewriterWidth(HERO_MESSAGES));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(box.textContent!.length).toBeGreaterThan(0);
    expect(HERO_MESSAGES[0].startsWith(box.textContent!)).toBe(true);
    expect(box.style.getPropertyValue('--typewriter-width')).toBe(width);

    expect(screen.getByText(messagesForScreenReaders(HERO_MESSAGES))).toHaveClass('sr-only');
  });

  it('shows the whole first line at once under reduced motion', () => {
    restore = mockReducedMotion(true);
    const { container } = render(<HeroSection />);
    expect(container.querySelector('#typewriter')).toHaveTextContent(HERO_MESSAGES[0]);
  });

  it('leads with one filled primary action; the other two are outlined', () => {
    render(<HeroSection />);
    const hero = document.getElementById('hero')!;
    const links = within(hero).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Collaborate with Me',
      'Explore YuriODev Vision',
      'View Research & Projects',
    ]);
    const [primary, ...others] = links;
    expect(primary).toHaveAttribute('href', `mailto:${EMAILS.contact}`);
    expect(primary).toHaveClass(buttonStyles.primary);
    expect(primary).not.toHaveClass(buttonStyles.ghost);
    for (const link of others) {
      expect(link).toHaveClass(buttonStyles.ghost);
      expect(link).not.toHaveClass(buttonStyles.primary);
    }
    expect(hero.querySelectorAll(`.${buttonStyles.primary}`)).toHaveLength(1);
  });

  it('keeps the profile card reachable from the keyboard, so a phone can scroll it', () => {
    render(<HeroSection />);
    const card = screen.getByRole('region', { name: 'Profile information' });
    expect(card).toHaveAttribute('tabindex', '0');
  });
});
