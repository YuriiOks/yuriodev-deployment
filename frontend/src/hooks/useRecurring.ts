import { useCallback, useState } from 'react';
import { fetchAttention, fetchRecurring, fetchUpcoming, type Attention, type RecurringList, type Upcoming } from '../services/dashboards/recurringApi';
import { useOnce, type LoadStatus } from './useFinance';

interface Kept<T> {
  readonly status: LoadStatus;
  readonly value: T | null;
  readonly reload: () => void;
}

/** While an answer is being asked again (after a change, or for another window) the last good one stays on screen, so the cards do not vanish and come back; an error shows as one. */
function keepLast<T>(slot: Kept<T>): Kept<T> {
  const [kept, setKept] = useState<T | null>(null);
  if (slot.value && slot.value !== kept) setKept(slot.value);
  const value = slot.status === 'error' ? null : (slot.value ?? kept);
  return { status: value && slot.status === 'loading' ? 'ready' : slot.status, value, reload: slot.reload };
}

/** The recurring payments (GET /finance/recurring): the debts, the management view and the names the attention cards use. */
export const useRecurring = (enabled: boolean) => keepLast(useOnce<RecurringList>(fetchRecurring, enabled));

/** The payments due from today for 14 or 30 days (GET /finance/upcoming); asked again when the window changes. */
export function useUpcoming(days: number, enabled: boolean) {
  const load = useCallback((signal: AbortSignal) => fetchUpcoming(days, signal), [days]);
  return keepLast(useOnce<Upcoming>(load, enabled));
}

/** What needs attention (GET /finance/attention); `includeHidden` also lists the snoozed and dismissed ones. */
export function useAttention(includeHidden: boolean, enabled: boolean) {
  const load = useCallback((signal: AbortSignal) => fetchAttention(includeHidden, signal), [includeHidden]);
  return keepLast(useOnce<Attention>(load, enabled));
}
