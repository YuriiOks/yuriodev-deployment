import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../../../context/useTheme';
import type { Theme } from '../../../context/theme-context';
import {
  complete,
  execute,
  type Execution,
  type TerminalContext,
  type TerminalLine,
} from '../../../services/terminalService';
import styles from './InteractiveTerminal.module.css';

interface ShownLine extends TerminalLine {
  id: number;
}

const PROMPT = 'visitor@yuriodev:~$';
const HISTORY_LIMIT = 50;
const BLANK: TerminalLine = { text: '\u00A0', type: 'output' };

const InteractiveTerminal: React.FC = () => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<ShownLine[]>([]);
  const terminalOutputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  // Earlier command lines, oldest first; ArrowUp/ArrowDown walk them.
  const history = useRef<string[]>([]);
  // Where ArrowUp/ArrowDown are in the history; null while editing a new line.
  const historyIndex = useRef<number | null>(null);
  // The half-typed line ArrowUp left, restored by ArrowDown past the newest entry.
  const draft = useRef('');
  // Bumped by `clear`, so a slow command's answer never lands on a cleared screen.
  const screen = useRef(0);
  const mounted = useRef(true);

  const { theme, toggleTheme } = useTheme();
  const context = useMemo<TerminalContext>(
    () => ({
      theme,
      setTheme: (wanted: Theme) => {
        if (wanted !== theme) toggleTheme();
      },
    }),
    [theme, toggleTheme],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (terminalOutputRef.current) {
      terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
    }
  }, [output]);

  const append = (lines: readonly TerminalLine[]) => {
    const shown = lines.map((line) => ({ ...line, id: nextId.current++ }));
    setOutput((current) => [...current, ...shown]);
  };

  const show = (echo: TerminalLine, result: Execution) => {
    if (result.kind === 'clear') {
      screen.current += 1;
      setOutput([]);
    } else {
      append([echo, ...result.lines, BLANK]);
    }
  };

  const submit = () => {
    const line = input;
    if (!line.trim()) return;
    const past = history.current;
    if (past[past.length - 1] !== line) past.push(line);
    if (past.length > HISTORY_LIMIT) past.shift();
    historyIndex.current = null;
    draft.current = '';
    setInput('');

    const echo: TerminalLine = { text: `${PROMPT} ${line}`, type: 'command' };
    const result = execute(line, context);
    if (!(result instanceof Promise)) {
      show(echo, result);
      return;
    }
    // A command that asks the network: the typed line shows now, the answer when it arrives.
    const screenNow = screen.current;
    append([echo, { text: 'Working...', type: 'comment' }]);
    void result.then((answer) => {
      if (!mounted.current || screen.current !== screenNow) return;
      if (answer.kind === 'clear') show(echo, answer);
      else append([...answer.lines, BLANK]);
    });
  };

  const recall = (direction: -1 | 1): boolean => {
    const past = history.current;
    const index = historyIndex.current;
    if (direction === -1) {
      if (past.length === 0) return false;
      if (index === null) draft.current = input;
      const next = index === null ? past.length - 1 : Math.max(0, index - 1);
      historyIndex.current = next;
      setInput(past[next]);
      return true;
    }
    if (index === null) return false;
    if (index + 1 >= past.length) {
      historyIndex.current = null;
      setInput(draft.current);
    } else {
      historyIndex.current = index + 1;
      setInput(past[index + 1]);
    }
    return true;
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // A key that confirms an IME composition (CJK input and similar) belongs
    // to the composition. Safari reports it as keyCode 229 instead.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        submit();
        break;
      case 'ArrowUp':
        if (recall(-1)) e.preventDefault();
        break;
      case 'ArrowDown':
        if (recall(1)) e.preventDefault();
        break;
      case 'Tab': {
        // Only when there is something to complete: otherwise Tab moves
        // focus on as usual, so the field never traps the keyboard.
        if (e.shiftKey) break;
        const completion = complete(input);
        if (!completion) break;
        e.preventDefault();
        setInput(completion.value);
        if (completion.candidates.length > 0) {
          append([
            { text: `${PROMPT} ${input}`, type: 'command' },
            { text: completion.candidates.join('  '), type: 'info' },
          ]);
        }
        break;
      }
      default:
        break;
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    historyIndex.current = null;
    setInput(e.target.value);
  };

  // Focus input when clicking on terminal
  const handleTerminalClick = () => {
    inputRef.current?.focus();
  };

  return (
    <div className={styles.terminalWrapper}>
      {/* Mac-style window header */}
      <div className={styles.terminalHeader}>
        <div className={styles.trafficLights}>
          <span className={`${styles.trafficLight} ${styles.red}`}></span>
          <span className={`${styles.trafficLight} ${styles.yellow}`}></span>
          <span className={`${styles.trafficLight} ${styles.green}`}></span>
        </div>
        <div className={styles.terminalTitle}>visitor@yuriodev: ~</div>
        <div className={styles.terminalActions}></div>
      </div>
      
      {/* Terminal content */}
      <div className={styles.interactiveTerminal} onClick={handleTerminalClick}>
        {/* New output is announced politely to screen readers. */}
        <div
          className={styles.terminalOutput}
          ref={terminalOutputRef}
          role="log"
          aria-live="polite"
          aria-label="Terminal output"
        >
          <div className={`${styles.terminalLine} ${styles.success}`}>
            Welcome to YuriODev Terminal v2.0.1
          </div>
          <div className={`${styles.terminalLine} ${styles.info}`}>
            Type 'help' for available commands, or try: skills, contact, projects, surprise
          </div>
          <div className={`${styles.terminalLine} ${styles.comment}`}>
            Tab completes a command; the up and down arrows recall earlier ones.
          </div>
          <div className={styles.terminalLine}>&nbsp;</div>
          {output.map((line) => (
            <div key={line.id} className={`${styles.terminalLine} ${styles[line.type]}`} data-line-type={line.type}>
              {line.text}
            </div>
          ))}
        </div>
        <div className={styles.terminalInputLine}>
          <span className={styles.terminalPromptInteractive}>{PROMPT}</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            className={styles.terminalInput}
            placeholder="Type a command..."
            aria-label="Terminal command input"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
          />
        </div>
      </div>
    </div>
  );
};

export default InteractiveTerminal;
