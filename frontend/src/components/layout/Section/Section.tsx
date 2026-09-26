import React from 'react';
import type { PageId, SectionId } from '../../../data/site';
import { cx } from '../../../utils/cx';
import Container, { type ContainerSize } from '../Container/Container';
import styles from './Section.module.css';

export interface SectionProps extends Omit<React.HTMLAttributes<HTMLElement>, 'id'> {
  /** A section or page id from data/site.ts: a typo does not compile. */
  id: SectionId | PageId;
  /** The id of the element that names the section; default `${id}-title` (the SectionHeader's id). */
  labelledBy?: string;
  /** The size of the inner Container (default: the content column). */
  width?: ContainerSize;
  /** Classes for the inner Container, e.g. a section whose padding sits inside its column. */
  containerClassName?: string;
  ref?: React.Ref<HTMLElement>;
  children: React.ReactNode;
}

/**
 * A top-level block of a page: <section>, named by its heading, with its
 * content in a centred Container. The alternating band colour stays
 * positional (global.css), so it keeps alternating when an optional section
 * is absent. Vertical and outer padding come from className.
 */
const Section: React.FC<SectionProps> = ({
  id,
  labelledBy,
  width = 'content',
  containerClassName,
  className,
  children,
  ...rest
}) => (
  <section {...rest} id={id} aria-labelledby={labelledBy ?? `${id}-title`} className={cx(styles.section, className)}>
    <Container size={width} className={containerClassName}>
      {children}
    </Container>
  </section>
);

export default Section;
