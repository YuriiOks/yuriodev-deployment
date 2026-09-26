import React from 'react';
import InteractiveTerminal from '../../ui/InteractiveTerminal/InteractiveTerminal';
import SocialIcon from '../../ui/SocialIcon/SocialIcon';
import { TERMINAL_ANCHOR, socialsFor } from '../../../data/site';
import styles from './ConnectSection.module.css';

const CONNECT_SOCIALS = socialsFor('connect');

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

        {/* Profiles, each a labelled button */}
        <ul className={styles.socialLinks} aria-label="Profiles">
          {CONNECT_SOCIALS.map(({ id, url, label, icon }) => (
            <li key={id}>
              <a href={url} target="_blank" rel="noopener noreferrer" className={styles.socialLink}>
                <SocialIcon icon={icon} className={styles.socialLinkIcon} />
                <span>{label}</span>
              </a>
            </li>
          ))}
        </ul>

        {/* Interactive Terminal (the target of '#terminal' links) */}
        <div className={styles.terminalContainer} id={TERMINAL_ANCHOR}>
          <InteractiveTerminal />
        </div>
      </div>
    </section>
  );
};

export default ConnectSection;
