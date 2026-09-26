import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRootScale } from './rootScale';

const originalGetComputedStyle = window.getComputedStyle;

afterEach(() => {
  document.documentElement.style.fontSize = '';
  window.getComputedStyle = originalGetComputedStyle;
});

describe('getRootScale', () => {
  it('is 1 at the default 16px root', () => {
    expect(getRootScale()).toBeCloseTo(1, 5);
  });

  it('tracks a grown root font size', () => {
    document.documentElement.style.fontSize = '32px';
    expect(getRootScale()).toBeCloseTo(2, 5);
  });

  it('falls back to 1 when the computed font size cannot be read', () => {
    window.getComputedStyle = vi.fn(() => ({ fontSize: 'not-a-size' })) as unknown as typeof window.getComputedStyle;
    expect(getRootScale()).toBe(1);
  });
});
