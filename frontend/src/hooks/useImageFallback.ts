import { useEffect, useState } from 'react';

/**
 * What to do when a picture cannot be loaded (the server was restarting, a request failed): `failed` is true at once, so the page shows the
 * name or the letter tile instead of a broken-image box; once, a few seconds later, the picture is asked for again (`attempt` changes, so the
 * <img> is created again). A second failure stays a failure until the address changes.
 */
export function useImageFallback(address: string | null | undefined, retryAfterMs = 5000): { failed: boolean; attempt: number; onError: () => void } {
  // 0: loading or loaded, 1: failed, 2: asked again, 3: failed again.
  const [state, setState] = useState<{ address: string | null | undefined; step: 0 | 1 | 2 | 3 }>({ address, step: 0 });
  const step = state.address === address ? state.step : 0;
  useEffect(() => {
    if (step !== 1) return undefined;
    const timer = setTimeout(() => setState({ address, step: 2 }), retryAfterMs);
    return () => clearTimeout(timer);
  }, [step, address, retryAfterMs]);
  const onError = () => setState({ address, step: step === 0 ? 1 : step === 2 ? 3 : step });
  return { failed: step === 1 || step === 3, attempt: step >= 2 ? 1 : 0, onError };
}
