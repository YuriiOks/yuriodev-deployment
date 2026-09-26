import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { noteJump, recentJump, scrollToId } from '../utils/scroll';

/** How long after a fragment jump a late web font may still put it back on target. */
const FONT_SETTLE_MS = 3000;

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
    if (!id) return;
    scrollToId(id);
    // A page that opens at a fragment jumps before the web font is in; the
    // font then reflows the text above the target, and the browser's scroll
    // anchoring does not always keep the target in place. Once the font is
    // in, jump again, unless another jump has been asked for since.
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts || fonts.status !== 'loading') return;
    let cancelled = false;
    fonts.ready.then(() => {
      if (!cancelled && recentJump(FONT_SETTLE_MS) === id) scrollToId(id);
    });
    return () => {
      cancelled = true;
    };
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
