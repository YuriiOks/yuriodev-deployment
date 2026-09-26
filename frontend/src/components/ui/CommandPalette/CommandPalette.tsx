import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTheme } from '../../../context/useTheme';
import { useSectionNav } from '../../../context/useSectionNav';
import { useToast } from '../../../context/useToast';
import { EMAILS } from '../../../data/site';
import { useSingleKeyShortcuts } from '../../../hooks/useSingleKeyShortcuts';
import Dialog from '../Dialog/Dialog';
import { buildCommands, groupRuns, rankCommands, type PaletteCommand } from './commands';
import styles from './CommandPalette.module.css';

// External links open in a new tab with no opener and no referrer.
function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onShowHelp: () => void;
  /** See Dialog's returnFocus. */
  returnFocus?: () => readonly (HTMLElement | null | undefined)[];
}

/**
 * Ctrl/Cmd+K, or the header's search button: a filterable list of every
 * section, setting and profile. A combobox (the input) that controls a
 * listbox; the arrow keys move the selection and Enter runs it.
 */
const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, onShowHelp, returnFocus }) => {
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
      returnFocus={returnFocus}
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
  const [singleKeys] = useSingleKeyShortcuts();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  // From the command, not its position: when typing changes the results the
  // active option's id changes too, so screen readers announce the new one.
  const optionId = (command: PaletteCommand) => `${baseId}-${command.id}`;

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
      }, { singleKeys }),
    [sections, goTo, toggleTheme, onShowHelp, toast, singleKeys],
  );

  const results = useMemo(() => rankCommands(commands, query), [commands, query]);
  const active = results.length === 0 ? -1 : Math.min(selected, results.length - 1);
  // The full list shows its groups; a filtered one is ranked, best first.
  const grouped = !query.trim();

  // Keep the selected option in view inside the list (not scrollIntoView:
  // that may scroll the page too); with a group's first option selected,
  // its heading too. Then mark whether more options sit below the fold.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const option = active >= 0 ? list.querySelector<HTMLElement>(`[data-index="${active}"]`) : null;
    if (option) {
      const before = option.previousElementSibling;
      const top = before instanceof HTMLElement && before.dataset.heading !== undefined ? before.offsetTop : option.offsetTop;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
      }
    }
    markMoreBelow(list);
  }, [active, results]);

  // On the first open this component lays out before Dialog's showModal()
  // makes the list visible, so measure again once the list gets its size.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => markMoreBelow(list));
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

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

  const renderOption = (command: PaletteCommand, index: number) => (
    // Options are picked with the arrow keys from the input (which keeps
    // focus), or by pointer.
    <div
      key={command.id}
      id={optionId(command)}
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
      {command.hint && <span className={styles.commandHint}>{command.hint}</span>}
    </div>
  );

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
        aria-activedescendant={active >= 0 ? optionId(results[active]) : undefined}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
      />
      {/* Not a Tab stop: the input keeps focus and drives the list. */}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Commands"
        tabIndex={-1}
        className={styles.commandResults}
        onScroll={(e) => markMoreBelow(e.currentTarget)}
      >
        {grouped
          ? groupRuns(results).map(({ group, start, items }) => {
              const headingId = `${baseId}-group-${group}`;
              return (
                <div key={group} role="group" aria-labelledby={headingId}>
                  <div id={headingId} role="presentation" data-heading="" className={styles.groupLabel}>
                    {group}
                  </div>
                  {items.map((command, i) => renderOption(command, start + i))}
                </div>
              );
            })
          : results.map((command, index) => renderOption(command, index))}
      </div>
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

/**
 * Marks the list while more options sit below its visible part, so the
 * stylesheet can fade its bottom edge: a list cut at a row boundary looks
 * complete, and overlay scrollbars show nothing until scrolled.
 */
function markMoreBelow(list: HTMLElement) {
  const more = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
  if (more) list.dataset.more = '';
  else delete list.dataset.more;
}

export default CommandPalette;
