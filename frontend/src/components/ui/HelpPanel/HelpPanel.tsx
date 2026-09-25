import React, { useId } from 'react';
import { SHORTCUTS } from '../../../data/site';
import { TERMINAL_COMMANDS } from '../../../services/terminalService';
import { useSingleKeyShortcuts } from '../../../hooks/useSingleKeyShortcuts';
import Dialog from '../Dialog/Dialog';
import styles from './HelpPanel.module.css';

interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
}

const SINGLE_KEYS = SHORTCUTS.filter(({ singleKey }) => singleKey).map(({ display }) => display);

/** Lists the keyboard shortcuts and the terminal's commands; a drawer on the right. */
const HelpPanel: React.FC<HelpPanelProps> = ({ open, onClose }) => (
  <Dialog
    open={open}
    onClose={onClose}
    title="Help"
    placement="right"
    surface="solid"
    footer={
      <p className={styles.helpFooter}>
        Press <kbd className={styles.shortcut}>Esc</kbd> or click outside to close
      </p>
    }
  >
    <HelpContent />
  </Dialog>
);

const HelpContent: React.FC = () => {
  const [singleKeysOn, setSingleKeysOn] = useSingleKeyShortcuts();
  const shortcutsId = useId();
  const switchLabelId = useId();
  const switchHintId = useId();
  const commandsId = useId();

  return (
    <div className={styles.helpPanelContent}>
      <section aria-labelledby={shortcutsId}>
        <h3 id={shortcutsId}>Keyboard Shortcuts</h3>
        <dl className={styles.helpSection}>
          {SHORTCUTS.map(({ id, label, display, singleKey }) => (
            <div key={id} className={styles.helpItem} data-off={singleKey && !singleKeysOn ? '' : undefined}>
              <dt>{label}</dt>
              <dd>
                <kbd className={styles.shortcut}>{display}</kbd>
              </dd>
            </div>
          ))}
        </dl>

        <div className={styles.switchRow}>
          <div>
            <p id={switchLabelId} className={styles.switchLabel}>
              Single-key shortcuts
            </p>
            <p id={switchHintId} className={styles.switchHint}>
              {SINGLE_KEYS.join(', ')}. Turn them off if you use speech input. Ctrl/Cmd + K, Home and End
              always work.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={singleKeysOn}
            aria-labelledby={switchLabelId}
            aria-describedby={switchHintId}
            className={styles.switch}
            onClick={() => setSingleKeysOn(!singleKeysOn)}
          >
            <span className={styles.switchTrack} aria-hidden="true">
              <span className={styles.switchThumb} />
            </span>
            <span className={styles.switchState} aria-hidden="true">
              {singleKeysOn ? 'On' : 'Off'}
            </span>
          </button>
        </div>
      </section>

      <section aria-labelledby={commandsId}>
        <h3 id={commandsId}>Terminal Commands</h3>
        <dl className={styles.helpSection}>
          {TERMINAL_COMMANDS.map(({ name, description }) => (
            <div key={name} className={styles.helpItem}>
              <dt className={styles.command}>{name}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
};

export default HelpPanel;
