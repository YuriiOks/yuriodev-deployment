import React from 'react';
import type { Tone } from '../../../utils/tagTone';
import { cx } from '../../../utils/cx';
import styles from './Chip.module.css';

export interface ChipProps extends React.HTMLAttributes<HTMLElement> {
  /** The colour (see utils/tagTone.ts for a tag's tone); default cyan. */
  tone?: Tone;
  /** 'li' inside a list of chips; default 'span'. */
  as?: 'span' | 'li';
  children: React.ReactNode;
}

/**
 * A tag: static text in a pill, never interactive. Its text is its meaning;
 * the colour only groups.
 */
const Chip: React.FC<ChipProps> = ({ tone = 'cyan', as = 'span', className, ...rest }) =>
  React.createElement(as, { ...rest, 'data-tone': tone, className: cx(styles.chip, className) });

export default Chip;
