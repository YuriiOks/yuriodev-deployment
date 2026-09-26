import React from 'react';
import { cx } from '../../../utils/cx';
import styles from './Badge.module.css';

export type BadgeTone = 'accent' | 'ok' | 'muted';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** accent: amber fill (featured, ongoing, active; default); ok: completed; muted: planned, a type. */
  tone?: BadgeTone;
  children: React.ReactNode;
}

/** A status label. The text is the status ("Featured", "Completed"), so colour is never the only cue. */
const Badge: React.FC<BadgeProps> = ({ tone = 'accent', className, ...rest }) => (
  <span {...rest} data-tone={tone} className={cx(styles.badge, className)} />
);

export default Badge;
