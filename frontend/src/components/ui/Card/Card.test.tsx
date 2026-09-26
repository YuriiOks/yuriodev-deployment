import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Card from './Card';
import styles from './Card.module.css';

describe('Card', () => {
  it('is a plain div with medium padding by default', () => {
    const { container } = render(<Card>content</Card>);
    const card = container.firstElementChild!;
    expect(card.tagName).toBe('DIV');
    expect(card).toHaveAttribute('data-tone', 'plain');
    expect(card).toHaveClass(styles.card, styles['pad-md']);
    expect(card).not.toHaveClass(styles.interactive);
    expect(card).not.toHaveClass(styles.featured);
    expect(card).not.toHaveClass(styles.radiusLg);
  });

  it('an article card is named by its title', () => {
    render(
      <Card as="article" labelledBy="p1-title">
        <h3 id="p1-title">Project one</h3>
      </Card>,
    );
    expect(screen.getByRole('article', { name: 'Project one' })).toBeInTheDocument();
  });

  it('maps tone, interactive, featured, padding and radius to classes, and keeps its own last', () => {
    const { container } = render(
      <Card tone="accent" interactive featured padding="none" radius="lg" className="mine">
        content
      </Card>,
    );
    const card = container.firstElementChild!;
    expect(card).toHaveAttribute('data-tone', 'accent');
    expect(card).toHaveClass(styles.accent, styles.interactive, styles.featured, styles['pad-none'], styles.radiusLg);
    expect(card.className).toMatch(/(^|\s)mine$/);
  });

  it('passes a ref and other attributes to the element', () => {
    const ref = createRef<HTMLElement>();
    render(
      <Card as="li" ref={ref} data-testid="c" title="t">
        x
      </Card>,
    );
    const card = screen.getByTestId('c');
    expect(ref.current).toBe(card);
    expect(card.tagName).toBe('LI');
    expect(card).toHaveAttribute('title', 't');
  });
});
