import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTheme } from '../../../context/useTheme';
import { useSectionNav } from '../../../context/useSectionNav';
import { useToast } from '../../../context/useToast';
import { EMAILS } from '../../../data/site';
import Dialog from '../Dialog/Dialog';
import { buildCommands, rankCommands, type PaletteCommand } from './commands';
import styles from './CommandPalette.module.css';

// External links open in a new tab with no opener and no referrer.
function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onShowHelp: () => void;
}

/**
 * Ctrl/Cmd+K, or the header's search button: a filterable list of every
 * section, setting and profile. A combobox (the input) that controls a
 * listbox; the arrow keys move the selection and Enter runs it.
 */
const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, onShowHelp }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Command palette"
      hideTitle
      placement="top"
      surface="glass"
      initialFocus={inputRef}
      className={styles.palette}
    >
      <PaletteBody inputRef={inputRef} onClose={onClose} onShowHelp={onShowHelp} />
    </Dialog>
  );
};

interface PaletteBodyProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onShowHelp: () => void;
}

/** Mounted only while the palette is open, so every opening starts with an empty query. */
const PaletteBody: React.FC<PaletteBodyProps> = ({ inputRef, onClose, onShowHelp }) => {
  const { toggleTheme } = useTheme();
  const { sections, goTo } = useSectionNav();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const commands = useMemo(
    () =>
      buildCommands(sections, {
        goTo,
        toggleTheme,
        showHelp: onShowHelp,
        openExternal,
        sendEmail: () => {
          window.location.href = `mailto:${EMAILS.personal}`;
        },
        copyEmail: () => {
          const failed = () =>
            toast.show({ message: `Could not copy. The address is ${EMAILS.personal}`, tone: 'err', durationMs: 8000 });
          if (!navigator.clipboard?.writeText) {
            failed();
            return;
          }
          navigator.clipboard.writeText(EMAILS.personal).then(
            () => toast.show({ message: `Copied ${EMAILS.personal}` }),
            failed,
          );
        },
      }),
    [sections, goTo, toggleTheme, onShowHelp, toast],
  );

  const results = useMemo(() => rankCommands(commands, query), [commands, query]);
  const active = results.length === 0 ? -1 : Math.min(selected, results.length - 1);

  // Keep the selected option in view inside the list (not scrollIntoView:
  // that may scroll the page too).
  useLayoutEffect(() => {
    const list = listRef.current;
    const option = active >= 0 ? list?.querySelector<HTMLElement>(`[data-index="${active}"]`) : null;
    if (!list || !option) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [active]);

  const run = (command: PaletteCommand) => {
    // Close first, synchronously: the page is scrollable again and focus is
    // back where it was before the command scrolls, opens or copies.
    flushSync(onClose);
    command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const count = results.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (count) setSelected((active + 1) % count);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (count) setSelected((active - 1 + count) % count);
        break;
      case 'Enter':
        e.preventDefault();
        if (active >= 0) run(results[active]);
        break;
      default:
        break;
    }
  };

  return (
    <div className={styles.content}>
      <input
        ref={inputRef}
        type="text"
        className={styles.commandInput}
        placeholder="Type a command or search..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
        }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-label="Search commands"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
      />
      <ul ref={listRef} id={listId} role="listbox" aria-label="Commands" className={styles.commandResults}>
        {results.map((command, index) => (
          // Options are picked with the arrow keys from the input (which
          // keeps focus), or by pointer.
          <li
            key={command.id}
            id={optionId(index)}
            data-index={index}
            role="option"
            aria-selected={index === active}
            className={`${styles.commandItem} ${index === active ? styles.selected : ''}`}
            onClick={() => run(command)}
            onPointerMove={() => {
              if (index !== active) setSelected(index);
            }}
          >
            <span className={styles.commandTitle}>{command.title}</span>
            <span className={styles.commandHint}>{command.hint}</span>
          </li>
        ))}
      </ul>
      {results.length === 0 && (
        <p className={styles.empty} role="status">
          No commands match "{query.trim()}"
        </p>
      )}
      <p className={styles.footer} aria-hidden="true">
        <kbd>↑</kbd> <kbd>↓</kbd> to move · <kbd>Enter</kbd> to run · <kbd>Esc</kbd> to close
      </p>
    </div>
  );
};

export default CommandPalette;
