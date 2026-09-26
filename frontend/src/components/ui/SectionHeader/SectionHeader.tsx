import React from 'react';
import { cx } from '../../../utils/cx';
import styles from './SectionHeader.module.css';

export interface SectionHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'id'> {
  title: React.ReactNode;
  /** The heading's id; Section names itself with it (convention: `${sectionId}-title`). */
  id: string;
  /** 2 (default) for a section of a page; 1 for a page's only top-level heading. */
  level?: 1 | 2;
  /** A short line above the title, e.g. '// latest posts'. */
  eyebrow?: React.ReactNode;
  subtitle?: React.ReactNode;
  align?: 'center' | 'start';
  /** The '# ' before the title (drawn by CSS, silent to screen readers); default true. */
  prompt?: boolean;
  /** More lines under the subtitle. */
  children?: React.ReactNode;
}

/**
 * A section's heading block: the '# title' with its neon underline, and an
 * optional eyebrow and subtitle. The title takes focus programmatically
 * (tabIndex -1), so section navigation can move focus to it.
 */
const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  id,
  level = 2,
  eyebrow,
  subtitle,
  align = 'center',
  prompt = true,
  className,
  children,
  ...rest
}) => {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <div {...rest} className={cx(styles.header, className)} data-align={align}>
      {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
      <Heading id={id} tabIndex={-1} data-section-title="" className={cx(styles.title, prompt && styles.prompt)}>
        {title}
      </Heading>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      {children}
    </div>
  );
};

export default SectionHeader;
