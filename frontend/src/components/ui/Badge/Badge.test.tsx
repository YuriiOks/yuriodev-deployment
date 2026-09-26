import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge from './Badge';

describe('Badge', () => {
  it('is an accent status label by default', () => {
    render(<Badge>Featured</Badge>);
    const badge = screen.getByText('Featured');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveAttribute('data-tone', 'accent');
  });

  it.each(['ok', 'muted'] as const)('takes the %s tone and extra attributes', (tone) => {
    render(
      <Badge tone={tone} className="extra" title="status">
        Status
      </Badge>,
    );
    const badge = screen.getByText('Status');
    expect(badge).toHaveAttribute('data-tone', tone);
    expect(badge).toHaveAttribute('title', 'status');
    expect(badge.className).toMatch(/(^|\s)extra$/);
  });
});
