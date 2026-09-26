import React, { useEffect } from 'react';
import { SHORTCUTS } from '../../../data/site';
import styles from './HelpPanel.module.css';

interface HelpPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const HelpPanel: React.FC<HelpPanelProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  return (
    <>
      {isOpen && (
        <div className={styles.backdrop} onClick={onClose} />
      )}
      {/* inert while closed: off screen, so nothing in it may take focus. */}
      <div
        className={`${styles.helpPanel} ${isOpen ? styles.active : ''}`}
        inert={!isOpen}
      >
        <div className={styles.helpPanelContent}>
          <button className={styles.closeButton} onClick={onClose} aria-label="Close help panel">
            ✕
          </button>

        <h3>Keyboard Shortcuts</h3>
        <div className={styles.helpSection}>
          {SHORTCUTS.map(({ id, label, display }) => (
            <div key={id} className={styles.helpItem}>
              <span>{label}</span>
              <span className={styles.shortcut}>{display}</span>
            </div>
          ))}
        </div>

        <h3>Terminal Commands</h3>
        <div className={styles.helpSection}>
          <div className={styles.helpItem}>
            <span className={styles.command}>help</span>
            <span>Show available commands</span>
          </div>
          <div className={styles.helpItem}>
            <span className={styles.command}>skills</span>
            <span>List technical skills</span>
          </div>
          <div className={styles.helpItem}>
            <span className={styles.command}>contact</span>
            <span>Show contact information</span>
          </div>
          <div className={styles.helpItem}>
            <span className={styles.command}>projects</span>
            <span>List recent projects</span>
          </div>
          <div className={styles.helpItem}>
            <span className={styles.command}>surprise</span>
            <span>Easter egg command</span>
          </div>
          <div className={styles.helpItem}>
            <span className={styles.command}>clear</span>
            <span>Clear terminal output</span>
          </div>
          <div className={styles.helpItem}>
            <span className={styles.command}>about</span>
            <span>Display information</span>
          </div>
        </div>

        <div className={styles.helpFooter}>
          <p>Press <span className={styles.shortcut}>ESC</span> or click outside to close</p>
        </div>
        </div>
      </div>
    </>
  );
};

export default HelpPanel;
