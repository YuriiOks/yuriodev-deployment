import type { Category } from '../../../services/dashboards/financeApi';
import type { DrawnIconName } from '../ProjectIcon/iconPaths';

/** The drawing of each spending category, from the dashboards' own set. */
export const CATEGORY_ICON: Readonly<Record<Category, DrawnIconName>> = {
  housing_utilities: 'home',
  groceries: 'cat-groceries',
  eating_out: 'cat-dining',
  transport: 'cat-transport',
  subscriptions: 'cat-subscriptions',
  health: 'heart-pulse',
  shopping: 'cat-shopping',
  entertainment: 'cat-entertainment',
  debt: 'cat-debt',
  income: 'arrow-down-left',
  transfers_out: 'arrow-up-right',
  transfers: 'cat-transfers',
  cash: 'cat-cash',
  other: 'cat-other',
};
