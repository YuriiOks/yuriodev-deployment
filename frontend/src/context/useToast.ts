import { useContext } from 'react';
import { ToastContext, type ToastApi } from './toast-context';

export const useToast = (): ToastApi => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
