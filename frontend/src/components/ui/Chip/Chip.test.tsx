import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Chip from './Chip';
import { tagTone } from '../../../utils/tagTone';

describe('Chip', () => {
  it('is static cyan text by default', () => {
    render(<Chip>Python</Chip>);
    const chip = screen.getByText('Python');
    expect(chip.tagName).toBe('SPAN');
    expect(chip).toHaveAttribute('data-tone', 'cyan');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('takes a tone from tagTone, and can be a list item', () => {
    render(
      <ul>
        <Chip as="li" tone={tagTone('LangGraph')} className="extra">
          LangGraph
        </Chip>
      </ul>,
    );
    const chip = screen.getByRole('listitem');
    expect(chip).toHaveAttribute('data-tone', 'violet');
    expect(chip.className).toMatch(/(^|\s)extra$/);
  });
});
