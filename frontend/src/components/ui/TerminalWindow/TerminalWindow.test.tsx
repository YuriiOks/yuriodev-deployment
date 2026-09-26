import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import TerminalWindow from './TerminalWindow';
import styles from './TerminalWindow.module.css';

describe('TerminalWindow', () => {
  it('has a bar with hidden window dots and a title, over the body', () => {
    const { container } = render(<TerminalWindow title="visitor@yuriodev: ~">output</TerminalWindow>);
    const root = container.firstElementChild!;
    expect(root.tagName).toBe('DIV');
    expect(root).toHaveAttribute('data-surface', 'solid');
    const dots = root.querySelector(`.${styles.dots}`)!;
    expect(dots).toHaveAttribute('aria-hidden', 'true');
    expect(dots.children).toHaveLength(3);
    expect(screen.getByText('visitor@yuriodev: ~')).toBeInTheDocument();
    const body = screen.getByText('output');
    expect(body).toHaveClass(styles.body, styles.scanlines);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('the title can be the heading, the root a named figure, the surface accent glass', () => {
    render(
      <TerminalWindow
        as="figure"
        aria-label="Profile information"
        title="$ cat ./profile.json"
        titleAs="h3"
        surface="glassAccent"
        scanlines={false}
        actions={<button type="button">Copy</button>}
        bodyClassName="mine"
      >
        {'{}'}
      </TerminalWindow>,
    );
    const figure = screen.getByRole('figure', { name: 'Profile information' });
    expect(figure).toHaveAttribute('data-surface', 'glassAccent');
    expect(screen.getByRole('heading', { level: 3, name: '$ cat ./profile.json' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    const body = screen.getByText('{}');
    expect(body).not.toHaveClass(styles.scanlines);
    expect(body).toHaveClass('mine');
  });
});
