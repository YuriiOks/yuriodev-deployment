import React from 'react';
import { cx } from '../../../utils/cx';
import styles from './Container.module.css';

export type ContainerSize = 'content' | 'prose' | 'full';

export interface ContainerProps extends React.HTMLAttributes<HTMLElement> {
  /** content: the page's content column (default); prose: a readable measure; full: the whole width. */
  size?: ContainerSize;
  as?: 'div' | 'nav' | 'header' | 'footer';
}

/** The horizontal frame for a block of content, centred on the page. */
const Container: React.FC<ContainerProps> = ({ size = 'content', as: Tag = 'div', className, ...rest }) => (
  <Tag {...rest} className={cx(styles.container, styles[size], className)} data-size={size} />
);

export default Container;
