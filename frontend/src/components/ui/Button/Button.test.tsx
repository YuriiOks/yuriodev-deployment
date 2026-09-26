import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Button from './Button';
import styles from './Button.module.css';

describe('Button', () => {
  it('is a <button type="button"> with the ghost look and the prompt by default', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass(styles.btn, styles.ghost, styles.prompt);
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps an explicit type', () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('while loading is disabled, busy and shows a static ellipsis', () => {
    render(<Button loading>Sending</Button>);
    const button = screen.getByRole('button', { name: 'Sending' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('Sending…');
  });

  it('with a same-site href is a plain link', () => {
    render(<Button href="#projects">Projects</Button>);
    const link = screen.getByRole('link', { name: 'Projects' });
    expect(link).toHaveAttribute('href', '#projects');
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
  });

  it('a mailto link stays in the tab', () => {
    render(<Button href="mailto:someone@example.com">Write</Button>);
    const link = screen.getByRole('link', { name: 'Write' });
    expect(link).not.toHaveAttribute('target');
  });

  it('a link to another site opens a new tab, safely, and says so', () => {
    render(<Button href="https://example.com/work">Work</Button>);
    const link = screen.getByRole('link');
    expect(link).toHaveAccessibleName(/^Work \(opens in new tab\)$/);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', ' JavaScript:alert(1)'])('does not link to %s', (href) => {
    render(<Button href={href}>Bad</Button>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Bad')).not.toHaveAttribute('href');
  });

  it('a disabled link is text in the button shape, out of the tab order', () => {
    render(
      <Button href="https://example.com" disabled>
        Coming soon
      </Button>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    const text = screen.getByText('Coming soon');
    expect(text.tagName).toBe('SPAN');
    expect(text).toHaveAttribute('aria-disabled', 'true');
    expect(text).not.toHaveAttribute('tabindex');
  });

  it('a disabled link keeps its name and other attributes, but none that only a link has', () => {
    render(
      <Button
        href="https://example.com"
        disabled
        variant="icon"
        aria-label="GitHub (coming soon)"
        id="gh"
        title="Soon"
        data-testid="gh"
        target="_blank"
        rel="me"
        download
      >
        <svg aria-hidden="true" />
      </Button>,
    );
    const text = screen.getByTestId('gh');
    expect(text.tagName).toBe('SPAN');
    expect(text).toHaveAttribute('aria-label', 'GitHub (coming soon)');
    expect(text).toHaveAttribute('id', 'gh');
    expect(text).toHaveAttribute('title', 'Soon');
    for (const name of ['href', 'target', 'rel', 'download']) expect(text).not.toHaveAttribute(name);
  });

  it('with `to` is a router link', () => {
    render(
      <MemoryRouter>
        <Button to="/privacy" variant="primary">
          Privacy
        </Button>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Privacy' });
    expect(link).toHaveAttribute('href', '/privacy');
    expect(link).toHaveClass(styles.primary);
  });

  it('an icon button is named by its label and has no prompt', () => {
    render(
      <Button variant="icon" aria-label="Close help">
        <svg aria-hidden="true" />
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Close help' });
    expect(button).toHaveClass(styles.icon);
    expect(button).not.toHaveClass(styles.prompt);
  });

  it('maps size, block, prompt and className to classes, with its own last', () => {
    render(
      <Button size="sm" block prompt={false} className="mine">
        Go
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button).toHaveClass(styles.sm, styles.block);
    expect(button).not.toHaveClass(styles.prompt);
    expect(button.className).toMatch(/(^|\s)mine$/);
  });
});
