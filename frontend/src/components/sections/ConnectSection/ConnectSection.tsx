import React from 'react';
import InteractiveTerminal from '../../ui/InteractiveTerminal/InteractiveTerminal';
import styles from './ConnectSection.module.css';

const ConnectSection: React.FC = () => {
  return (
    <section id="connect" className={styles.section}>
      <div className={styles.sectionContent}>
        {/* Header */}
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Let's Chat</h2>
          <p className={styles.subtitle}>
            Ready to start a conversation? Whether you're looking for a consultant, collaborator, 
            or technical advisor, let's discuss how we can work together to build something exceptional.
            Use the terminal below to explore my contact information and connect with me.
          </p>
        </div>

        {/* Interactive Terminal (the target of '#terminal' links) */}
        <div className={styles.terminalContainer} id="terminal">
          <InteractiveTerminal />
        </div>
      </div>
    </section>
  );
};

export default ConnectSection;
