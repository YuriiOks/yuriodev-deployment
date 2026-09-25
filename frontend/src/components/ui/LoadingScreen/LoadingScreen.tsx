import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './LoadingScreen.module.css';

interface LoadingScreenProps {
  onComplete?: () => void;
}

/**
 * The whole first-visit screen, fade included. The budget is 1.2s; 1s leaves
 * room for timers that fire late while the page renders underneath.
 */
const LOADER_TOTAL_MS = 1000;
const FADE_MS = 250;

const STAGES = [
  { progress: 0, text: 'Initializing systems...' },
  { progress: 15, text: 'Loading AI modules...' },
  { progress: 30, text: 'Bootstrapping ML pipelines...' },
  { progress: 50, text: 'Configuring agentic workflows...' },
  { progress: 70, text: 'Compiling portfolio data...' },
  { progress: 90, text: 'Finalizing deployment...' },
  { progress: 100, text: 'Ready!' },
];
// Every stage has shown by the time the fade starts.
const STAGE_MS = Math.floor((LOADER_TOTAL_MS - FADE_MS) / STAGES.length);

/**
 * First-visit intro. It covers the page for about 1s (1.2s at most); the Skip button, or
 * any key press (Escape included), ends it at once. It never holds focus: the
 * page underneath stays reachable, and a Tab both ends the intro and moves on.
 */
const LoadingScreen: React.FC<LoadingScreenProps> = ({ onComplete }) => {
  const [stage, setStage] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onComplete?.();
  }, [onComplete]);

  useEffect(() => {
    const timers = STAGES.slice(1).map((_, i) => window.setTimeout(() => setStage(i + 1), (i + 1) * STAGE_MS));
    timers.push(window.setTimeout(() => setLeaving(true), LOADER_TOTAL_MS - FADE_MS));
    timers.push(window.setTimeout(finish, LOADER_TOTAL_MS));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [finish]);

  // Capture phase on window: this runs before the page's own shortcuts, so the
  // key that ends the intro does nothing else (no theme flip, no section jump,
  // no scroll). Tab still moves focus, and browser shortcuts (Ctrl/Cmd/Alt
  // combinations) keep working; the page's shortcuts ignore those anyway.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      if (e.key !== 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
      }
      finish();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [finish]);

  const { progress, text: loadingText } = STAGES[stage];

  return (
    <div className={`${styles.loadingScreen} ${leaving ? styles.fadeOut : ''}`}>
      <div className={styles.loadingContainer}>
        {/* ASCII Art Logo */}
        <div className={styles.asciiLogo} aria-hidden="true">
          <pre className={styles.asciiArt}>
{`
██╗   ██╗  ██╗   ██╗  ██████╗   ██╗   ██████╗  ██████╗   ███████╗  ██╗   ██╗
╚██╗ ██╔╝  ██║   ██║  ██╔══██╗  ██║  ██╔═══██╗ ██╔══██╗  ██╔════╝  ██║   ██║
 ╚████╔╝   ██║   ██║  ██████╔╝  ██║  ██║   ██║ ██║  ██║  █████╗    ╚██╗ ██╔╝
  ╚██╔╝    ██║   ██║  ██╔══██╗  ██║  ██║   ██║ ██║  ██║  ██╔══╝     ╚████╔╝ 
   ██║     ╚██████╔╝  ██║  ██║  ██║  ╚██████╔╝ ██████╔╝  ███████╗    ╚██╔╝  
   ╚═╝      ╚═════╝   ╚═╝  ╚═╝  ╚═╝  ╚═════╝   ╚═════╝   ╚══════╝     ╚═╝ 
`}
          </pre>
        </div>

        {/* Loading text. Decorative: the page underneath is already readable, and the Skip
            button is what assistive tech needs, so the stages are not announced. */}
        <div className={styles.loadingText} aria-hidden="true">
          <span className={styles.prompt}>$ </span>
          <span className={styles.text}>{loadingText}</span>
          <span className={styles.cursor} aria-hidden="true">_</span>
        </div>

        {/* Progress Bar */}
        <div className={styles.progressContainer} aria-hidden="true">
          <div className={styles.progressBar}>
            <div 
              className={styles.progressFill}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className={styles.progressText}>{progress}%</div>
        </div>

        {/* Loading Animation - Rotating ASCII Squares */}
        <div className={styles.loadingAnimation} aria-hidden="true">
          <div className={styles.spinnerContainer}>
            <div className={styles.square}>▪</div>
            <div className={styles.square}>▪</div>
            <div className={styles.square}>▪</div>
            <div className={styles.square}>▪</div>
            <div className={styles.square}>▪</div>
            <div className={styles.square}>▪</div>
            <div className={styles.square}>▪</div>
            <div className={styles.square}>▪</div>
            <div className={styles.square}>▪</div>
            <div className={styles.square}>▪</div>
          </div>
        </div>
      </div>
      <button type="button" className={styles.skipButton} onClick={finish} aria-keyshortcuts="Escape">
        Skip intro
        <kbd className={styles.skipKey} aria-hidden="true">
          Esc
        </kbd>
      </button>
    </div>
  );
};

export default LoadingScreen;
