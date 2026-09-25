import React, { useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** The dialog's accessible name; shown as its heading unless hideTitle. */
  title: string;
  /** Keep the title for screen readers only (the palette's input is its visible top). */
  hideTitle?: boolean;
  /** 'top': a panel near the top of the view (palette); 'right': a full-height drawer (help). */
  placement?: 'top' | 'right';
  surface?: 'glass' | 'solid';
  /**
   * What gets focus on open: the title (default), the scrolling body (so the
   * arrow keys scroll a long dialog straight away) or a given element.
   */
  initialFocus?: 'title' | 'body' | React.RefObject<HTMLElement | null>;
  /**
   * Where focus goes on close when the element that had it before the dialog
   * opened can no longer take it (hidden or removed meanwhile, such as a link
   * in a menu the dialog closed). The first candidate that takes focus wins.
   */
  returnFocus?: () => readonly (HTMLElement | null | undefined)[];
  /** A click on the backdrop closes the dialog. Default true. */
  closeOnScrim?: boolean;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/**
 * A modal native <dialog>, opened with showModal(): it sits in the browser's
 * top layer above every z-index, and the rest of the page is inert while it
 * is open. Mounted only while open, in a portal on <body>.
 *
 * React state stays the source of truth: Escape, a backdrop click, the close
 * button and a close the browser makes on its own all go through onClose.
 * On close, focus goes back to whatever had it before the dialog opened.
 */
const Dialog: React.FC<DialogProps> = (props) => {
  if (!props.open) return null;
  return createPortal(<OpenDialog {...props} />, document.body);
};

const OpenDialog: React.FC<DialogProps> = ({
  onClose,
  title,
  hideTitle = false,
  placement = 'top',
  surface = 'solid',
  initialFocus = 'title',
  returnFocus,
  closeOnScrim = true,
  footer,
  className,
  children,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Read once, when the dialog opens.
  const initialFocusRef = useRef(initialFocus);
  const returnFocusRef = useRef(returnFocus);
  // What had focus before the dialog opened. Kept from the first open, so a
  // development-mode StrictMode remount does not record the dialog's own
  // focus target instead.
  const openerRef = useRef<HTMLElement | null | undefined>(undefined);
  // The latest onClose, so the open/close effect below runs only once.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  // Set while this component closes the dialog itself, so the resulting
  // 'close' event is not reported back as a close request.
  const closingRef = useRef(false);
  // A backdrop click must start on the backdrop too: a text selection
  // dragged out of the panel ends in a click on the backdrop.
  const pressedScrimRef = useRef(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (openerRef.current === undefined) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    const opener = openerRef.current;
    const returnFocus = returnFocusRef.current;
    // Reset on every open: StrictMode runs the cleanup below once on mount.
    closingRef.current = false;
    if (!dialog.open) dialog.showModal();
    const focusTarget = initialFocusRef.current;
    const target =
      focusTarget === 'title' ? titleRef.current : focusTarget === 'body' ? bodyRef.current : focusTarget.current;
    target?.focus();
    const root = document.documentElement;
    root.dataset.overlay = 'open';

    return () => {
      delete root.dataset.overlay;
      closingRef.current = true;
      if (dialog.open) dialog.close();
      // preventScroll: the opener may be far from where a command just scrolled to.
      if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
      if (opener && document.activeElement !== opener) {
        for (const candidate of returnFocus?.() ?? []) {
          candidate?.focus({ preventScroll: true });
          if (candidate && document.activeElement === candidate) break;
        }
      }
    };
  }, []);

  const requestClose = () => onCloseRef.current();

  const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    // Handled here rather than left to the browser's cancel: the same path
    // in every engine, and Escape that ends an IME composition is not a close.
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      requestClose();
    }
  };

  const onCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    // Any other close request (such as the Android back gesture).
    e.preventDefault();
    requestClose();
  };

  const onNativeClose = () => {
    // The browser closed the dialog without asking; bring state in line.
    // A 'close' that arrives while the dialog is open again is the late echo
    // of an earlier close (StrictMode's mount cleanup in development).
    if (!closingRef.current && !dialogRef.current?.open) requestClose();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDialogElement>) => {
    pressedScrimRef.current = e.target === e.currentTarget;
  };

  const onClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    const onScrim = e.target === e.currentTarget && pressedScrimRef.current;
    pressedScrimRef.current = false;
    if (closeOnScrim && onScrim) requestClose();
  };

  const classes = [styles.dialog, styles[placement], className].filter(Boolean).join(' ');

  return (
    // Keyboard users close with Escape (onKeyDown); the click handler only
    // adds the pointer shortcut of clicking the backdrop.
    <dialog
      ref={dialogRef}
      className={classes}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={onCancel}
      onClose={onNativeClose}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <div className={`${styles.panel} ${styles[surface]}`}>
        {hideTitle ? (
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className={`${styles.title} sr-only`}>
            {title}
          </h2>
        ) : (
          <div className={styles.head}>
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className={styles.title}>
              {title}
            </h2>
            <button type="button" className={styles.close} onClick={requestClose} aria-label="Close">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        )}
        {/* Focusable (not tabbable) only when it takes the initial focus. */}
        <div ref={bodyRef} className={styles.body} tabIndex={initialFocus === 'body' ? -1 : undefined}>
          {children}
        </div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </dialog>
  );
};

export default Dialog;
