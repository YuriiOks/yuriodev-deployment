import { useEffect } from 'react';
import { useOverlay } from '../context/useOverlay';
import { useSectionNav } from '../context/useSectionNav';
import { useTheme } from '../context/useTheme';
import { shortcutDefFor } from '../data/site';
import { scrollBehavior } from '../utils/motion';
import { useSingleKeyShortcuts } from './useSingleKeyShortcuts';

/** True for targets where a typed character belongs to the field, not to a shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable ||
    // isContentEditable is missing in some environments (jsdom); the attribute is the fallback.
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

/**
 * The site's keyboard shortcuts (the list lives in data/site.ts), in one
 * document listener:
 * - Ctrl/Cmd+K toggles the command palette from anywhere, fields included.
 * - Every other shortcut is a key pressed with no Ctrl, Cmd or Alt, so
 *   Ctrl/Cmd+K never also counts as K. They never fire while typing in a
 *   field, during an IME composition, or while a dialog is open (except '?',
 *   which closes the help it opened).
 * - The single-key ones (?, J, K, T) are skipped while the visitor has
 *   turned them off in the help panel.
 */
export function useGlobalShortcuts(): void {
  const { active, toggle, close } = useOverlay();
  const { toggleTheme } = useTheme();
  const { step } = useSectionNav();
  const [singleKeysOn] = useSingleKeyShortcuts();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      const shortcut = shortcutDefFor(e);
      if (!shortcut) return;

      if (shortcut.id === 'palette') {
        e.preventDefault();
        toggle('palette');
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (shortcut.singleKey && !singleKeysOn) return;

      if (active === 'palette' || active === 'help') {
        if (shortcut.id === 'help' && active === 'help') {
          e.preventDefault();
          close('help');
        }
        return;
      }

      switch (shortcut.id) {
        case 'help':
          e.preventDefault();
          toggle('help');
          break;
        case 'theme':
          e.preventDefault();
          toggleTheme();
          break;
        case 'next':
          e.preventDefault();
          step(1);
          break;
        case 'prev':
          e.preventDefault();
          step(-1);
          break;
        case 'top':
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: scrollBehavior() });
          break;
        case 'bottom':
          e.preventDefault();
          window.scrollTo({ top: document.body.scrollHeight, behavior: scrollBehavior() });
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, toggle, close, toggleTheme, step, singleKeysOn]);
}
