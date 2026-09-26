import React from 'react';
import { cx } from '../../../utils/cx';
import styles from './Card.module.css';

export type CardTone = 'plain' | 'accent';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /** 'article' for a self-contained item (a project, a post); default 'div'. */
  as?: 'div' | 'article' | 'li' | 'section';
  /** plain: a quiet border (default); accent: the brand-tinted border and shadow. */
  tone?: CardTone;
  /** Lifts, with an amber edge, under a hovering pointer; the edge also shows while a keyboard user is inside. */
  interactive?: boolean;
  /** An amber edge and glow: the card to look at first. */
  featured?: boolean;
  /** Inner padding: none 0, sm 1.25rem, md 1.5rem (default), lg 2rem. */
  padding?: CardPadding;
  radius?: 'md' | 'lg';
  /** aria-labelledby: an article or section card is named by its title. */
  labelledBy?: string;
  ref?: React.Ref<HTMLElement>;
}

/**
 * A solid surface that carries content (never glass). There is no whole-card
 * click target: the links and buttons inside are the targets.
 */
const Card: React.FC<CardProps> = ({
  as = 'div',
  tone = 'plain',
  interactive = false,
  featured = false,
  padding = 'md',
  radius = 'md',
  labelledBy,
  className,
  ...rest
}) =>
  React.createElement(as, {
    ...rest,
    'aria-labelledby': labelledBy ?? rest['aria-labelledby'],
    'data-tone': tone,
    className: cx(
      styles.card,
      styles[tone],
      interactive && styles.interactive,
      featured && styles.featured,
      styles[`pad-${padding}`],
      radius === 'lg' && styles.radiusLg,
      className,
    ),
  });

export default Card;
