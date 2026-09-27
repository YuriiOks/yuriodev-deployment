import type { CSSProperties } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import IconChip from './IconChip';

describe('IconChip', () => {
  it('is decorative by default: the tile and its icon are both aria-hidden', () => {
    const { container } = render(<IconChip name="graduation-cap" />);
    const chip = container.firstElementChild;
    expect(chip).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('becomes a labelled image when a label is given, on the icon, not the tile', () => {
    render(<IconChip name="briefcase" label="Experience" />);
    screen.getByRole('img', { name: 'Experience' });
    const tile = screen.getByRole('img', { name: 'Experience' }).parentElement;
    expect(tile).not.toHaveAttribute('aria-hidden');
  });

  it('takes extra className and an inline style override (e.g. a per-type accent)', () => {
    const { container } = render(
      <IconChip name="scroll" className="extra" style={{ '--icon-chip-fg': 'var(--cyan-text)' } as CSSProperties} />,
    );
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.className).toMatch(/(^|\s)extra$/);
    expect(chip.style.getPropertyValue('--icon-chip-fg')).toBe('var(--cyan-text)');
  });
});
