import { useContext } from 'react';
import { OverlayContext, type OverlayState } from './overlay-context';

export const useOverlay = (): OverlayState => {
  const context = useContext(OverlayContext);
  if (context === undefined) {
    throw new Error('useOverlay must be used within an OverlayProvider');
  }
  return context;
};
