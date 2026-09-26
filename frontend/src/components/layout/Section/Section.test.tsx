import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Section from './Section';

describe('Section', () => {
  it('is a region named by its "<id>-title" heading, with the content in a Container', () => {
    render(
      <Section id="about">
        <h2 id="about-title">About</h2>
        <p>text</p>
      </Section>,
    );
    const region = screen.getByRole('region', { name: 'About' });
    expect(region).toHaveAttribute('id', 'about');
    expect(region).toHaveAttribute('aria-labelledby', 'about-title');
    const inner = region.firstElementChild!;
    expect(inner).toHaveAttribute('data-size', 'content');
    expect(inner).toContainElement(screen.getByText('text'));
  });

  it('takes another label, a width, classes for both boxes and a ref', () => {
    const ref = createRef<HTMLElement>();
    render(
      <Section id="projects" labelledBy="custom" width="full" className="outer" containerClassName="inner" ref={ref}>
        <h2 id="custom">Work</h2>
      </Section>,
    );
    const region = screen.getByRole('region', { name: 'Work' });
    expect(ref.current).toBe(region);
    expect(region.className).toMatch(/(^|\s)outer$/);
    const inner = region.firstElementChild!;
    expect(inner).toHaveAttribute('data-size', 'full');
    expect(inner.className).toMatch(/(^|\s)inner$/);
  });
});
