import React, { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useOverlay } from '../../../context/useOverlay';
import type { PageDef, PageId } from '../../../data/site';
import { cx } from '../../../utils/cx';
import styles from './Header.module.css';

interface MoreMenuProps {
  pages: readonly PageDef[];
  currentPage: PageId | undefined;
}

/**
 * The header's secondary pages behind one button: a disclosure (a button with
 * aria-expanded that shows a list of links), not an ARIA menu. It is one of
 * the page's overlays, so opening the palette, the help panel or the header
 * menu closes it and opening it closes them. Escape closes it and returns
 * focus to the button; so does following a link, a click outside, Tab past
 * its last link and a route change (OverlayProvider).
 */
const MoreMenu: React.FC<MoreMenuProps> = ({ pages, currentPage }) => {
  const { active, toggle, close } = useOverlay();
  const open = active === 'more';
  const rootRef = useRef<HTMLLIElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  // The current page is one of these: the button carries the marker too.
  const holdsCurrent = pages.some(({ id }) => id === currentPage);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const focused = document.activeElement;
      const focusInside = !focused || focused === document.body || rootRef.current?.contains(focused);
      close('more');
      if (focusInside) buttonRef.current?.focus();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close('more');
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  // Tabbing out of the menu closes it, so it never covers what gets focus next.
  const onBlur = (e: React.FocusEvent<HTMLLIElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && !rootRef.current?.contains(next)) close('more');
  };

  return (
    <li className={styles.moreItem} ref={rootRef} onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        className={cx(styles.navControl, styles.moreButton, holdsCurrent && styles.current)}
        aria-expanded={open}
        aria-controls={listId}
        data-opens="more"
        onClick={() => toggle('more')}
      >
        --more
        <svg className={styles.caret} aria-hidden="true" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>
      <ul id={listId} className={styles.morePanel} hidden={!open}>
        {pages.map(({ id, path, navLabel }) => (
          <li key={id}>
            <Link
              to={path}
              className={cx(styles.moreLink, currentPage === id && styles.current)}
              aria-current={currentPage === id ? 'page' : undefined}
              onClick={() => close('more')}
            >
              {navLabel}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
};

export default MoreMenu;
