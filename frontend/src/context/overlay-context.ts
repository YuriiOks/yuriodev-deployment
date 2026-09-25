import { createContext } from 'react';

/** The overlays that take over the page: two dialogs and the header's menu. */
export type OverlayId = 'palette' | 'help' | 'menu';

export interface OverlayState {
  /** The one overlay open right now, or null. */
  active: OverlayId | null;
  /** Opens `id`, closing whichever other overlay was open. */
  open: (id: OverlayId) => void;
  /** Closes `id` if it is the open one; leaves any other overlay alone. */
  close: (id: OverlayId) => void;
  /** Closes `id` when it is open, otherwise opens it (closing the others). */
  toggle: (id: OverlayId) => void;
}

export const OverlayContext = createContext<OverlayState | undefined>(undefined);
