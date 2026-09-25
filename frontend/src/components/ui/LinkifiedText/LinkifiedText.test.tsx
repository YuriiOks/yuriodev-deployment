import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import LinkifiedText from './LinkifiedText';
import { linkify, safeHref, shortUrl } from './linkify';
import source from './LinkifiedText.tsx?raw';

const links = () => screen.queryAllByRole('link');

describe('linkify', () => {
  it('links http and https URLs and nothing else', () => {
    expect(linkify('see https://example.com/a?b=1 now', 'linkedin')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'url', text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { kind: 'text', text: ' now' },
    ]);
    for (const text of [
      'javascript:alert(1)',
      'JavaScript:alert(document.cookie)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'ftp://example.com/file',
      'example.com',
      'https://user:pass@example.com/',
    ]) {
      expect(linkify(text, 'x').every(({ kind }) => kind === 'text'), text).toBe(true);
    }
  });

  it('leaves trailing punctuation outside the link, but keeps a closing bracket the URL opened', () => {
    expect(linkify('Read https://example.com/post.', 'x')[1]).toMatchObject({ text: 'https://example.com/post' });
    expect(linkify('(https://example.com/a)', 'x')[1]).toMatchObject({ text: 'https://example.com/a' });
    expect(linkify('https://en.wikipedia.org/wiki/Foo_(bar)!', 'x')[0]).toMatchObject({
      text: 'https://en.wikipedia.org/wiki/Foo_(bar)',
    });
  });

  it('links @handles to X profiles in X text only; hashtags stay text', () => {
    expect(linkify('thanks @some_one! #AI', 'x')).toEqual([
      { kind: 'text', text: 'thanks ' },
      { kind: 'mention', text: '@some_one', href: 'https://x.com/some_one' },
      { kind: 'text', text: '! #AI' },
    ]);
    expect(linkify('thanks @some_one #AI', 'linkedin')).toEqual([{ kind: 'text', text: 'thanks @some_one #AI' }]);
  });

  it('does not take addresses or over-long names for handles', () => {
    expect(linkify('mail me@example.com', 'x').every(({ kind }) => kind === 'text')).toBe(true);
    expect(linkify('@a_name_that_is_far_too_long', 'x').every(({ kind }) => kind === 'text')).toBe(true);
  });

  it('safeHref and shortUrl', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com/');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('not a url')).toBeNull();
    expect(shortUrl('https://www.example.com/a')).toBe('example.com/a');
    expect(shortUrl(`https://example.com/${'a'.repeat(80)}`)).toHaveLength(40);
  });
});

describe('LinkifiedText', () => {
  it('renders links that open in a new tab with nofollow ugc noopener noreferrer', () => {
    render(<LinkifiedText text="Blog: https://example.com/post and @friend" platform="x" />);
    const [url, mention] = links();
    expect(url).toHaveAttribute('href', 'https://example.com/post');
    expect(url).toHaveTextContent('example.com/post');
    expect(url).toHaveAttribute('target', '_blank');
    expect(url).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    expect(mention).toHaveAttribute('href', 'https://x.com/friend');
    expect(mention).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
  });

  it('shows HTML in the text as text, never as markup', () => {
    const text = '<img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a>';
    const { container } = render(<LinkifiedText text={text} platform="x" />);
    const paragraph = container.querySelector('p')!;
    expect(paragraph.children).toHaveLength(0);
    expect(paragraph.textContent).toBe(text);
    expect(links()).toHaveLength(0);
  });

  it('never links a javascript: URL', () => {
    render(<LinkifiedText text="click javascript:alert(1) or https://ok.example" platform="linkedin" />);
    expect(links()).toHaveLength(1);
    expect(links()[0]).toHaveAttribute('href', 'https://ok.example/');
  });

  it('keeps styled Unicode, emoji and line breaks exactly as written', () => {
    const text = '𝗕𝗼𝗹𝗱 opener 🚀\n\n• point one\n• point two 👩‍💻';
    const { container } = render(<LinkifiedText text={text} platform="linkedin" />);
    expect(container.querySelector('p')!.textContent).toBe(text);
  });

  it('does not use dangerouslySetInnerHTML', () => {
    expect(source).not.toContain('dangerouslySetInnerHTML');
  });
});
