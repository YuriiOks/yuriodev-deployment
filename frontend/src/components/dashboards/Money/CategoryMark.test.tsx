import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CATEGORIES } from '../../../services/dashboards/financeApi';
import { isDrawnIcon } from '../ProjectIcon/iconPaths';
import CategoryMark, { CATEGORY_ICON } from './CategoryMark';

describe('the category marks', () => {
  it('draws every category from the dashboards\' own set, each with its own drawing', () => {
    expect(Object.keys(CATEGORY_ICON).sort()).toEqual([...CATEGORIES].sort());
    for (const category of CATEGORIES) expect(isDrawnIcon(CATEGORY_ICON[category]), category).toBe(true);
    expect(new Set(Object.values(CATEGORY_ICON)).size).toBe(CATEGORIES.length);
  });

  it('is decorative, carries its category, and is a tile or a bare drawing', () => {
    const tile = render(<CategoryMark category="groceries" variant="tile" />);
    const mark = tile.container.firstElementChild as HTMLElement;
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveAttribute('data-category', 'groceries');
    expect(mark.querySelector('svg')).toHaveAttribute('data-icon', 'cat-groceries');
    expect(mark.querySelector('svg')).toHaveAttribute('width', '20');
    tile.unmount();
    const bare = render(<CategoryMark category="income" />);
    expect(bare.container.querySelector('svg')).toHaveAttribute('width', '14');
  });
});
