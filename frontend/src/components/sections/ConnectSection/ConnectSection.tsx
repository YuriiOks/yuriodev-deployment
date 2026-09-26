import React from 'react';
import InteractiveTerminal from '../../ui/InteractiveTerminal/InteractiveTerminal';
import SocialIcon from '../../ui/SocialIcon/SocialIcon';
import { TERMINAL_ANCHOR, socialsFor } from '../../../data/site';
import Section from '../../layout/Section/Section';
import SectionHeader from '../../ui/SectionHeader/SectionHeader';
import styles from './ConnectSection.module.css';

const CONNECT_SOCIALS = socialsFor('connect');

const ConnectSection: React.FC = () => {
  return (
    <Section id="connect" className={styles.section} width="full" containerClassName={styles.content}>
      <SectionHeader
        id="connect-title"
        title="Let's Chat"
        subtitle="Ready to start a conversation? Whether you're looking for a consultant, collaborator, or technical advisor, let's discuss how we can work together to build something exceptional. Use the terminal below to explore my contact information and connect with me."
      />

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
    </Section>
  );
};

export default ConnectSection;
