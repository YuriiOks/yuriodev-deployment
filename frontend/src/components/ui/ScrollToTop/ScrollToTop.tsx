import React, { useState, useEffect, useRef } from 'react';
import styles from './ScrollToTop.module.css';
import { scrollBehavior } from '../../../utils/motion';
import { getRootScale } from '../../../utils/rootScale';

/** How far down the page a visitor must scroll before the button appears, at the default 16px root. */
const REVEAL_SCROLL = 300;

interface ScrollToTopProps {
  /** Hide the button, for example while a dialog or drawer is open over the page. */
  suppressed?: boolean;
}

/**
 * Floating "back to top" button. It appears once the page is scrolled, and
 * steps aside while the footer is on screen, so it never sits on the footer's
 * text (the footer has its own links at the bottom of every page anyway).
 * While hidden it is also out of the tab order (visibility: hidden).
 */
function isKeyboardFocus(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true; // no :focus-visible support: treat any focus as keyboard focus
  }
}

const ScrollToTop: React.FC<ScrollToTopProps> = ({ suppressed = false }) => {
  const [scrolled, setScrolled] = useState(false);
  const [footerInView, setFooterInView] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  // Read once and on resize, not on every scroll tick.
  const rootScale = useRef(1);

  useEffect(() => {
    const updateScale = () => {
      rootScale.current = getRootScale();
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > REVEAL_SCROLL * rootScale.current);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const footer = document.querySelector('footer');
    if (!footer) return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setFooterInView(entry.isIntersecting);
    });
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  // Never hide the button while it has keyboard focus: visibility: hidden would
  // drop focus to <body>. It steps aside once focus moves on. (A mouse click
  // also focuses it in some browsers; that must not keep it on screen.)
  const isVisible = (scrolled && !footerInView && !suppressed) || hasFocus;

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: scrollBehavior()
    });
  };

  return (
    <button
      className={`${styles.scrollToTop} ${isVisible ? styles.visible : ''}`}
      onClick={scrollToTop}
      onFocus={(e) => setHasFocus(isKeyboardFocus(e.currentTarget))}
      onBlur={() => setHasFocus(false)}
      aria-label="Scroll to top"
      title="Scroll to top"
      data-hidden={isVisible ? undefined : 'true'}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 15l-6-6-6 6" />
      </svg>
    </button>
  );
};

export default ScrollToTop;
