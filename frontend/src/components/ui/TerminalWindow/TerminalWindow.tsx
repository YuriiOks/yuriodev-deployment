import React from 'react';
import { cx } from '../../../utils/cx';
import styles from './TerminalWindow.module.css';

export interface TerminalWindowProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** The bar's text, e.g. 'visitor@yuriodev: ~' or '$ cat ./vision.txt'. */
  title: React.ReactNode;
  /** A heading when the bar's text is the window's heading; default a div. */
  titleAs?: 'div' | 'h3' | 'h4';
  as?: 'div' | 'section' | 'article' | 'figure';
  /** solid (default); glassAccent only for the hero code block. */
  surface?: 'solid' | 'glassAccent';
  /** Faint static scanlines behind the text, dark theme only; default true. */
  scanlines?: boolean;
  /** The right-hand end of the bar (e.g. a copy button). */
  actions?: React.ReactNode;
  bodyClassName?: string;
  children: React.ReactNode;
}

/**
 * A terminal window: a bar with the three window dots and a title, over a
 * monospace body. The consumer owns the body's role (a live log, a figure).
 */
const TerminalWindow: React.FC<TerminalWindowProps> = ({
  title,
  titleAs: Title = 'div',
  as = 'div',
  surface = 'solid',
  scanlines = true,
  actions,
  bodyClassName,
  className,
  children,
  ...rest
}) =>
  React.createElement(
    as,
    { ...rest, 'data-surface': surface, className: cx(styles.window, styles[surface], className) },
    <div className={styles.bar}>
      <span className={styles.dots} aria-hidden="true">
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </span>
      <Title className={styles.title}>{title}</Title>
      <div className={styles.actions}>{actions}</div>
    </div>,
    <div className={cx(styles.body, scanlines && styles.scanlines, bodyClassName)}>{children}</div>,
  );

export default TerminalWindow;
