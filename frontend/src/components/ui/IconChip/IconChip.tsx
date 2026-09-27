import React from 'react';
import Icon, { type IconName } from '../Icon/Icon';
import { cx } from '../../../utils/cx';
import styles from './IconChip.module.css';

export interface IconChipProps {
  name: IconName;
  /** An accessible name for the chip, when nothing next to it already names it. */
  label?: string;
  className?: string;
  /** Overrides the chip's ink and glow (dark theme only) for one call site,
   * e.g. `{ '--icon-chip-fg': 'var(--cyan-text)', '--icon-chip-glow-rgb': 'var(--cyan-rgb)' }`. */
  style?: React.CSSProperties;
}

/**
 * A small rounded glass tile carrying one icon: amber on dark glass in the
 * dark theme (a soft glow), orange ink on a bordered white tile in light (no
 * glow). Sits before a section or card heading, or marks a timeline entry.
 * A plain `Icon` is for a glyph inside a line of text instead.
 */
const IconChip: React.FC<IconChipProps> = ({ name, label, className, style }) => (
  <span className={cx(styles.chip, className)} style={style} aria-hidden={label ? undefined : true}>
    <Icon name={name} label={label} size="1.15em" />
  </span>
);

export default IconChip;
