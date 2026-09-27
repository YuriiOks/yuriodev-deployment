import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Icon from './Icon';

describe('Icon', () => {
  it('is decorative by default: aria-hidden, no accessible name', () => {
    const { container } = render(<Icon name="rocket" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
    expect(svg).not.toHaveAttribute('aria-label');
  });

  it('becomes a labelled image when a label is given', () => {
    render(<Icon name="mail" label="Email" />);
    const svg = screen.getByRole('img', { name: 'Email' });
    expect(svg).not.toHaveAttribute('aria-hidden');
  });

  it('sizes itself in em by default, sitting on the text baseline', () => {
    const { container } = render(<Icon name="target" />);
    const svg = container.querySelector('svg');
    expect(svg?.style.width).toBe('1em');
    expect(svg?.style.height).toBe('1em');
    expect(svg?.style.verticalAlign).toBe('-0.15em');
  });

  it('takes a custom size', () => {
    const { container } = render(<Icon name="target" size="1.15em" />);
    const svg = container.querySelector('svg');
    expect(svg?.style.width).toBe('1.15em');
    expect(svg?.style.height).toBe('1.15em');
  });

  it('uses a consistent stroke width and is never focusable', () => {
    const { container } = render(<Icon name="briefcase" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('stroke-width', '1.75');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it('passes through extra props such as className', () => {
    const { container } = render(<Icon name="zap" className="extra" />);
    expect(container.querySelector('svg.extra')).not.toBeNull();
  });
});
