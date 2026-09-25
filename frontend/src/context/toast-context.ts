import { createContext } from 'react';

export interface ToastOptions {
  message: string;
  tone?: 'ok' | 'err';
  /** Default 4000. */
  durationMs?: number;
}

export interface ToastApi {
  /** Shows a short status message; a newer one replaces it. */
  show: (options: ToastOptions) => void;
}

export const ToastContext = createContext<ToastApi | undefined>(undefined);
