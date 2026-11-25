import { useEffect, useState } from 'react';
import { fetchManualCurrencies } from '../services/dashboards/manualApi';

let cached: readonly string[] | null = null;
const NONE: readonly string[] = [];

/** Forgets the list (tests start each case with none). */
export function resetManualCurrencies(): void {
  cached = null;
}

/** The currencies an account entered by hand may be in, asked for once; none until they are here, or when the server does not say (the form then takes a code). */
export function useManualCurrencies(): readonly string[] {
  const [list, setList] = useState<readonly string[]>(cached ?? NONE);
  useEffect(() => {
    if (cached) return undefined;
    const controller = new AbortController();
    fetchManualCurrencies(controller.signal).then(
      (codes) => {
        if (controller.signal.aborted) return;
        cached = codes;
        setList(codes);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, []);
  return list;
}
