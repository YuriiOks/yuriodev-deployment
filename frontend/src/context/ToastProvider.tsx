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
 *
 * The message stays while the pointer rests on it, while something in it has
 * focus and while text in it is selected (a visitor copying the address by
 * hand); its full time starts again once they move on.
 */
export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toast, setToast] = useState<ShownToast | null>(null);
  const nextId = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const toastRef = useRef<HTMLParagraphElement>(null);

  const show = useCallback(({ message, tone = 'ok', durationMs = 4000 }: ToastOptions) => {
    nextId.current += 1;
    setToast({ id: nextId.current, message, tone, durationMs });
  }, []);

  const stopTimer = () => window.clearTimeout(timer.current);

  const startTimer = useCallback((ms: number) => {
    window.clearTimeout(timer.current);
    const arm = () => {
      timer.current = window.setTimeout(() => {
        const selection = document.getSelection();
        const selectedInToast =
          selection && !selection.isCollapsed && toastRef.current?.contains(selection.anchorNode);
        if (selectedInToast) arm();
        else setToast(null);
      }, ms);
    };
    arm();
  }, []);

  useEffect(() => {
    if (!toast) return;
    startTimer(toast.durationMs);
    return () => window.clearTimeout(timer.current);
  }, [toast, startTimer]);

  const resume = () => {
    if (toast) startTimer(toast.durationMs);
  };

  const onBlur = (e: React.FocusEvent<HTMLParagraphElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume();
  };

  const value = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toast && (
          <p
            key={toast.id}
            ref={toastRef}
            className={styles.toast}
            data-tone={toast.tone}
            onPointerEnter={stopTimer}
            onPointerLeave={resume}
            onFocus={stopTimer}
            onBlur={onBlur}
          >
            {toast.message}
          </p>
        )}
      </div>
    </ToastContext.Provider>
  );
};
