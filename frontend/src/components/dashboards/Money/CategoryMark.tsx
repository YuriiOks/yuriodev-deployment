import React from 'react';
import type { Category } from '../../../services/dashboards/financeApi';
import ProjectIcon from '../ProjectIcon/ProjectIcon';
import { CATEGORY_ICON } from './categoryIcons';
import styles from './Category.module.css';

export interface CategoryMarkProps {
  category: Category;
  /** `tile` (a rounded square in the category's tint, for the spend list), `inline` (the bare drawing, for chips and tags). */
  variant?: 'tile' | 'inline';
  size?: 14 | 16 | 20;
}

/**
 * A category's mark: its drawing in its own colour (a fixed mapping from the theme's tokens, 4.6:1 or more on every surface). Decorative: the
 * category's name is always beside it, so the colour never carries the meaning alone.
 */
const CategoryMark: React.FC<CategoryMarkProps> = ({ category, variant = 'inline', size = variant === 'tile' ? 20 : 14 }) => (
  <span aria-hidden="true" className={variant === 'tile' ? styles.tile : styles.inline} data-category={category}>
    <ProjectIcon name={CATEGORY_ICON[category]} size={size} />
  </span>
);

export default CategoryMark;
