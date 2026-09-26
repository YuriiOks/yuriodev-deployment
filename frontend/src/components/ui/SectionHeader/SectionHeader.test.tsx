import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SectionHeader from './SectionHeader';
import styles from './SectionHeader.module.css';

describe('SectionHeader', () => {
  it('is an h2 with the given id that script can focus', () => {
    render(<SectionHeader id="about-title" title="About" />);
    const heading = screen.getByRole('heading', { level: 2, name: 'About' });
    expect(heading).toHaveAttribute('id', 'about-title');
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveAttribute('data-section-title');
  });

  it('is an h1 with level 1', () => {
    render(<SectionHeader id="page-title" level={1} title="Courses" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Courses' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('draws the "# " with the prompt class, not in the markup', () => {
    // jsdom has no generated content; the CSS gives the prompt an empty alt text.
    render(<SectionHeader id="t" title="Journey" />);
    const heading = screen.getByRole('heading');
    expect(heading).toHaveClass(styles.title, styles.prompt);
    expect(heading.textContent).toBe('Journey');
  });

  it('shows an eyebrow, a subtitle and more lines, in that order around the title', () => {
    render(
      <SectionHeader id="t" title="Latest posts" eyebrow="// feed" subtitle="What I wrote">
        <p>Synced 2 hours ago</p>
      </SectionHeader>,
    );
    const heading = screen.getByRole('heading');
    const block = heading.parentElement!;
    expect([...block.children].map((el) => el.textContent)).toEqual([
      '// feed',
      'Latest posts',
      'What I wrote',
      'Synced 2 hours ago',
    ]);
    expect(block).toHaveAttribute('data-align', 'center');
  });

  it('can align to the start and drop the prompt', () => {
    render(<SectionHeader id="t" title="Plain" align="start" prompt={false} className="extra" />);
    const heading = screen.getByRole('heading');
    expect(heading.parentElement).toHaveAttribute('data-align', 'start');
    expect(heading.parentElement!.className).toMatch(/(^|\s)extra$/);
    const withPrompt = render(<SectionHeader id="u" title="Prompted" />).getByRole('heading', { name: 'Prompted' });
    expect(heading.className.split(' ').length).toBe(withPrompt.className.split(' ').length - 1);
  });
});
