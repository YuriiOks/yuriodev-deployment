import { useSyncExternalStore } from 'react';
import {
  setSingleKeyShortcutsEnabled,
  singleKeyShortcutsEnabled,
  subscribeShortcutsPreference,
} from '../utils/shortcutsPreference';

const onByDefault = () => true;

/** [enabled, setEnabled] for the single-key shortcuts; shared by every caller and across tabs. */
export function useSingleKeyShortcuts(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribeShortcutsPreference, singleKeyShortcutsEnabled, onByDefault);
  return [enabled, setSingleKeyShortcutsEnabled];
}
