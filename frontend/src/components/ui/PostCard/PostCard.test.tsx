import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PostCard from './PostCard';
import { parsePostsResponse, type PostItem } from '../../../services/postsApi';
import { linkedinVariant, payload, rawItem, xVariant } from '../../../test/postsFixtures';

const NOW = Date.parse('2026-09-25T12:00:00Z');

function item(raw: Record<string, unknown>): PostItem {
  return parsePostsResponse(payload([raw]))!.items[0];
}

describe('PostCard', () => {
  it('is an article named after its platforms, date and opening words', () => {
    const post = item(rawItem({ x: xVariant(['𝗛𝗲𝗹𝗹𝗼 from a thread', 'part two']), linkedin: linkedinVariant('𝗛𝗲𝗹𝗹𝗼 LinkedIn') }));
    render(<PostCard item={post} now={NOW} />);
    const article = screen.getByRole('article');
    expect(article).toHaveAccessibleName(/^Post on LinkedIn and X, .*2026.*: Hello LinkedIn$/);
    // The visible text keeps the styled letters.
    expect(article).toHaveTextContent('𝗛𝗲𝗹𝗹𝗼 LinkedIn');
  });

  it('shows where it was published as text badges, and when in a <time>', () => {
    const post = item(rawItem({ x: xVariant(['one', 'two', 'three'], '2026-09-24T08:00:00Z'), linkedin: linkedinVariant('text') }));
    render(<PostCard item={post} now={NOW} />);
    const badges = within(screen.getByRole('list', { name: 'Published on' })).getAllByRole('listitem');
    expect(badges.map((badge) => badge.textContent)).toEqual(['LinkedIn', 'X · thread of 3']);
    const time = screen.getByText('yesterday');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-09-24T08:00:00Z');
  });

  it('links to every original, LinkedIn first, in a new tab without a referrer', () => {
    const li = linkedinVariant('text');
    const x = xVariant(['text']);
    render(<PostCard item={item(rawItem({ x, linkedin: li }))} now={NOW} />);
    const originals = within(screen.getByRole('list', { name: 'Originals' })).getAllByRole('link');
    expect(originals.map((a) => a.getAttribute('href'))).toEqual([li.url, x.url]);
    expect(originals[0]).toHaveAccessibleName('View on LinkedIn (opens in a new tab)');
    for (const link of originals) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('shows the first part of a thread, and the whole thread on request', async () => {
    const user = userEvent.setup();
    render(<PostCard item={item(rawItem({ x: xVariant(['first part', 'second part', 'third part']) }))} now={NOW} />);
    expect(screen.getByText('first part')).toBeInTheDocument();
    expect(screen.queryByText('second part')).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'Show full thread (3)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('Show less');
    expect(screen.getByText('third part')).toBeInTheDocument();
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(screen.getByText('third part'));
  });

  it('offers "Show more" for long text only', async () => {
    const { unmount } = render(<PostCard item={item(rawItem({ linkedin: linkedinVariant('Short post.') }))} now={NOW} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();

    render(<PostCard item={item(rawItem({ linkedin: linkedinVariant('word '.repeat(100)) }))} now={NOW} />);
    expect(screen.getByRole('button', { name: 'Show more' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('links @handles in X text only', () => {
    const { unmount } = render(<PostCard item={item(rawItem({ x: xVariant(['hi @friend']) }))} now={NOW} />);
    expect(screen.getByRole('link', { name: '@friend' })).toHaveAttribute('href', 'https://x.com/friend');
    unmount();
    render(<PostCard item={item(rawItem({ linkedin: linkedinVariant('hi @friend') }))} now={NOW} />);
    expect(screen.queryByRole('link', { name: '@friend' })).not.toBeInTheDocument();
  });

  it('shows an image with its alt text, or says the original has media', () => {
    const withImage = rawItem({ x: xVariant(['t']) }, { has_media: true, media: [{ url: '/api/media/1.jpg', alt: 'Architecture diagram' }] });
    const { unmount } = render(<PostCard item={item(withImage)} now={NOW} />);
    expect(screen.getByRole('img', { name: 'Architecture diagram' })).toHaveAttribute('src', '/api/media/1.jpg');
    unmount();

    render(<PostCard item={item(rawItem({ x: xVariant(['t']) }, { has_media: true }))} now={NOW} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/Includes images or video/)).toBeInTheDocument();
  });
});
