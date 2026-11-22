import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import styles from './NotConnected.module.css';

export interface NotConnectedProps {
  /** The source's name (the tab): the panel's title. */
  name: string;
}

/** What a source tab shows while its tool is not connected: the name, one line, one explanation. No sample rows. */
const NotConnected: React.FC<NotConnectedProps> = ({ name }) => {
  const { t } = useDashboardLang();
  return (
    <section aria-label={name} className={styles.panel}>
      <h2 className={styles.title}>{t.notConnectedTitle}</h2>
      <p className={styles.text}>{t.notConnectedText}</p>
    </section>
  );
};

export default NotConnected;
