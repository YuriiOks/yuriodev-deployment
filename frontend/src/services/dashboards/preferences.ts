import { readStorage, writeStorage } from '../../utils/safeStorage';

/** localStorage key of the calendar's "working days only" choice. */
export const WORKDAYS_STORAGE_KEY = 'dashboards-workdays';

export function readWorkdaysOnly(): boolean {
  return readStorage('local', WORKDAYS_STORAGE_KEY) === 'true';
}

export function writeWorkdaysOnly(on: boolean): void {
  writeStorage('local', WORKDAYS_STORAGE_KEY, on ? 'true' : 'false');
}
