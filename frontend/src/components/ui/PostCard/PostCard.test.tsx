import { describe, expect, it, vi } from 'vitest';
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
    const time = screen.getByText('1 day ago');
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

  it('says when the original has images or video, and never loads one', () => {
    const withMedia = rawItem({ x: xVariant(['t']) }, { has_media: true, media: [{ url: '/api/media/1.jpg', alt: 'Diagram' }] });
    render(<PostCard item={item(withMedia)} now={NOW} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/Includes images or video/)).toBeInTheDocument();
  });

  it('keeps links in clamped text out of the Tab order until the post is expanded', async () => {
    const user = userEvent.setup();
    const long = `${'word '.repeat(60)}\nRead https://example.com/write-up and more ${'word '.repeat(40)}`;
    render(<PostCard item={item(rawItem({ linkedin: linkedinVariant(long) }))} now={NOW} />);
    const inText = screen.getByRole('link', { name: 'example.com/write-up' });
    expect(inText).toHaveAttribute('tabindex', '-1');

    // Tab goes straight to "Show more", then to the original.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Show more' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: /View on LinkedIn/ })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getByRole('link', { name: 'example.com/write-up' })).not.toHaveAttribute('tabindex');
  });

  it('leaves links in short, unclamped text in the Tab order', () => {
    render(<PostCard item={item(rawItem({ linkedin: linkedinVariant('See https://example.com/a') }))} now={NOW} />);
    expect(screen.getByRole('link', { name: 'example.com/a' })).not.toHaveAttribute('tabindex');
  });

  it('brings the card back into view on "Show less" when its top has scrolled away', async () => {
    const user = userEvent.setup();
    render(<PostCard item={item(rawItem({ x: xVariant(['first part', 'second part']) }))} now={NOW} />);
    const article = screen.getByRole('article');
    const scrollIntoView = vi.fn();
    article.scrollIntoView = scrollIntoView;
    const toggle = screen.getByRole('button', { name: 'Show full thread (2)' });

    await user.click(toggle);
    expect(scrollIntoView).not.toHaveBeenCalled();

    // The reader has scrolled down the thread: the card's top is above the view.
    const top = vi.spyOn(article, 'getBoundingClientRect').mockReturnValue({ top: -500 } as DOMRect);
    await user.click(toggle);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
    expect(toggle).toHaveFocus();

    // Collapsing with the card's top still in view leaves the page alone.
    await user.click(toggle);
    top.mockReturnValue({ top: 200 } as DOMRect);
    scrollIntoView.mockClear();
    await user.click(toggle);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
