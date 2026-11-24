import { readStorage, writeStorage } from '../../utils/safeStorage';

/** localStorage key of the Money page's display choice. */
export const MONEY_DISPLAY_KEY = 'dashboards-money-display';

/** How the Money page shows amounts: converted into pounds (`base`, the default) or as each account has them (`native`). */
export type MoneyDisplay = 'base' | 'native';

export function readMoneyDisplay(): MoneyDisplay {
  return readStorage('local', MONEY_DISPLAY_KEY) === 'native' ? 'native' : 'base';
}

export function writeMoneyDisplay(mode: MoneyDisplay): void {
  writeStorage('local', MONEY_DISPLAY_KEY, mode);
}

/** localStorage key of the calendar's "working days only" choice. */
export const WORKDAYS_STORAGE_KEY = 'dashboards-workdays';

export function readWorkdaysOnly(): boolean {
  return readStorage('local', WORKDAYS_STORAGE_KEY) === 'true';
}

export function writeWorkdaysOnly(on: boolean): void {
  writeStorage('local', WORKDAYS_STORAGE_KEY, on ? 'true' : 'false');
}
