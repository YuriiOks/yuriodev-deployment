import { useCallback } from 'react';
import { fetchAttention, fetchRecurring, fetchUpcoming, type Attention, type RecurringList, type Upcoming } from '../services/dashboards/recurringApi';
import { useKeepLast, useOnce, type Kept } from './useFinance';
import { useIconBundle } from './useImageBundles';

/** The recurring payments (GET /finance/recurring): the debts, the management view and the names the attention cards use. */
export function useRecurring(enabled: boolean): Kept<RecurringList> {
  const slot = useKeepLast(useOnce<RecurringList>(fetchRecurring, enabled));
  return { ...slot, value: useIconBundle(slot.value) };
}

/** The payments due from today for 14 or 30 days (GET /finance/upcoming); asked again when the window changes. */
export function useUpcoming(days: number, enabled: boolean) {
  const load = useCallback((signal: AbortSignal) => fetchUpcoming(days, signal), [days]);
  const slot = useKeepLast(useOnce<Upcoming>(load, enabled));
  return { ...slot, value: useIconBundle(slot.value) };
}

/** What needs attention (GET /finance/attention); `includeHidden` also lists the snoozed and dismissed ones. */
export function useAttention(includeHidden: boolean, enabled: boolean) {
  const load = useCallback((signal: AbortSignal) => fetchAttention(includeHidden, signal), [includeHidden]);
  return useKeepLast(useOnce<Attention>(load, enabled));
}
