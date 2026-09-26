import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Container from './Container';

describe('Container', () => {
  it('is a div in the content column by default', () => {
    const { container } = render(<Container>text</Container>);
    const root = container.firstElementChild!;
    expect(root.tagName).toBe('DIV');
    expect(root).toHaveAttribute('data-size', 'content');
    expect(root).toHaveTextContent('text');
  });

  it('takes a size, an element and extra classes and attributes', () => {
    const { container } = render(
      <Container size="prose" as="nav" className="extra" aria-label="Pages">
        links
      </Container>,
    );
    const root = container.firstElementChild!;
    expect(root.tagName).toBe('NAV');
    expect(root).toHaveAttribute('data-size', 'prose');
    expect(root).toHaveAttribute('aria-label', 'Pages');
    expect(root.className).toMatch(/(^|\s)extra$/);
  });
});
