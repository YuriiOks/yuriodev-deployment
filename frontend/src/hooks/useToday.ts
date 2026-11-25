import { useCallback } from 'react';
import { fetchToday, type TodayData, type TodayScope } from '../services/dashboards/todayApi';
import { useKeepLast, useOnce } from './useFinance';

/** The Today view of a page (GET /today?scope=): asked on mount and on `reload`; the last good answer stays on screen while it is asked again. */
export function useToday(scope: TodayScope, enabled: boolean) {
  const load = useCallback((signal: AbortSignal) => fetchToday(scope, signal), [scope]);
  return useKeepLast(useOnce<TodayData>(load, enabled));
}
