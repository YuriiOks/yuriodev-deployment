import React from 'react';
import InteractiveTerminal from '../../ui/InteractiveTerminal/InteractiveTerminal';
import { usePageTitle } from '../../../hooks/usePageTitle';
import styles from './ComingSoonSection.module.css';

interface ComingSoonSectionProps {
  pageName: string;
  title: string;
  description: string;
  features?: string[];
}

const ComingSoonSection: React.FC<ComingSoonSectionProps> = ({ 
  pageName, 
  title, 
  description,
  features = []
}) => {
  usePageTitle(title);

  return (
    <section id={pageName} className={styles.comingSoonSection}>
      <div className={styles.contentWrapper}>
        <div className={styles.header}>
          <h1 className={styles.title}>
            <span className={styles.titlePrefix}>#</span> {title}
          </h1>
          <p className={styles.subtitle}>🚧 Under Active Development</p>
        </div>

        <div className={styles.descriptionCard}>
          <p className={styles.description}>{description}</p>
        </div>

        {features.length > 0 && (
          <div className={styles.featuresCard}>
            <h2 className={styles.featuresTitle}>
              <span className={styles.icon}>✨</span> Planned Features
            </h2>
            <ul className={styles.featuresList}>
              {features.map((feature, index) => (
                <li key={index} className={styles.featureItem}>
                  <span className={styles.bullet}>▹</span>
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={styles.terminalSection}>
          <h2 className={styles.terminalTitle}>
            <span className={styles.icon}>💻</span> Try the Interactive Terminal
          </h2>
          <p className={styles.terminalDescription}>
            While this page is under construction, explore my skills and projects using the terminal below:
          </p>
          <InteractiveTerminal />
        </div>

        <div className={styles.ctaSection}>
          <p className={styles.ctaText}>
            Want to stay updated on this page's launch?
          </p>
          <a href="/#connect" className={styles.ctaButton}>
            Get in Touch
          </a>
        </div>
      </div>
    </section>
  );
};

export default ComingSoonSection;
