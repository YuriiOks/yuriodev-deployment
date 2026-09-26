import React from 'react';
import { Link } from 'react-router-dom';
import SocialIcon from '../../ui/SocialIcon/SocialIcon';
import { EMAILS, IDENTITY, pagePath, socialsFor } from '../../../data/site';
import styles from './Footer.module.css';

const FOOTER_SOCIALS = socialsFor('footer');

const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className={styles.terminalFooter} role="contentinfo">
      <div className={styles.footerContent}>
        {/* Main Footer Row */}
        <div className={styles.footerMain}>
          {/* Left: Contact */}
          <div className={styles.footerLeft}>
            <a href={`mailto:${EMAILS.personal}`} className={styles.emailLink}>
              📧 {EMAILS.personal}
            </a>
            <span className={styles.location}>📍 {IDENTITY.location}</span>
          </div>

          {/* Center: Social Icons */}
          <div className={styles.socialIcons}>
            {FOOTER_SOCIALS.map(({ id, url, label, icon }) => (
              <a
                key={id}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.socialIcon}
                aria-label={label}
                title={label}
              >
                <SocialIcon icon={icon} />
              </a>
            ))}
          </div>

          {/* Right: Copyright & Tech */}
          <div className={styles.footerRight}>
            <span className={styles.copyright}>
              © {currentYear} <span className={styles.brand}>{IDENTITY.brand}</span>
            </span>
            <span className={styles.tech}>
              Built with <span className={styles.techHighlight}>React</span> + <span className={styles.techHighlight}>TypeScript</span> + <span className={styles.techHighlight}>Vite</span>
            </span>
            <Link to={pagePath('privacy')} className={styles.privacyLink}>Privacy notice</Link>
          </div>
        </div>

        {/* Terminal Status Line */}
        <div className={styles.statusLine}>
          <span className={styles.statusText}>
            exit_code: <span className={styles.statusSuccess}>0</span> | 
            status: <span className={styles.statusSuccess}>success</span> | 
            powered by ☕ and 💡
          </span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
