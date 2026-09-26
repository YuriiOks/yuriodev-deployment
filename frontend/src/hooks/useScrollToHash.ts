import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { noteJump, scrollToId } from '../utils/scroll';

function idFromHash(hash: string): string | null {
  if (hash.length < 2) return null;
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return null;
  }
}

/**
 * BrowserRouter does not scroll to a URL fragment after a client-side
 * navigation (for example a '/#about' link followed from /courses). Call this
 * from the page that owns the target ids: once the page has mounted, and after
 * every later navigation that carries a hash, it scrolls the matching element
 * into view. Every fragment jump, the browser's own ones included, is also
 * remembered (noteJump), so a section that appears late can put it back on
 * target.
 */
export function useScrollToHash(): void {
  const { hash, key } = useLocation();

  useEffect(() => {
    const id = idFromHash(hash);
    if (id) scrollToId(id);
  }, [hash, key]);

  useEffect(() => {
    const onHashChange = () => {
      const id = idFromHash(window.location.hash);
      if (id) noteJump(id);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
}
