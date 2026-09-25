import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ToastContext, type ToastApi, type ToastOptions } from './toast-context';
import styles from '../components/ui/Toast/Toast.module.css';

interface ToastProviderProps {
  children: React.ReactNode;
}

interface ShownToast extends Required<ToastOptions> {
  id: number;
}

/**
 * One status message at a time, in a live region that is always mounted so
 * screen readers announce each new message. It never takes focus. Show it
 * only after a modal dialog has closed: while one is open the rest of the
 * page, this region included, is inert.
 */
export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toast, setToast] = useState<ShownToast | null>(null);
  const nextId = useRef(0);

  const show = useCallback(({ message, tone = 'ok', durationMs = 4000 }: ToastOptions) => {
    nextId.current += 1;
    setToast({ id: nextId.current, message, tone, durationMs });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const value = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toast && (
          <p key={toast.id} className={styles.toast} data-tone={toast.tone}>
            {toast.message}
          </p>
        )}
      </div>
    </ToastContext.Provider>
  );
};
