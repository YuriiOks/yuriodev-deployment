import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { retryBootstrap } from '../../../services/dashboards/bootstrapStore';
import DashIcon from '../DashIcon/DashIcon';
import styles from './ServerUnreachable.module.css';

export interface ServerUnreachableProps {
  /** The bar still shows the last visit's names and projects (marked as remembered). */
  kept: boolean;
}

/**
 * What the dashboards show when the server did not answer the first request: a plain block with a retry, never the bundled
 * sample data (which is only the labelled demo of a server that says it has no database).
 */
const ServerUnreachable: React.FC<ServerUnreachableProps> = ({ kept }) => {
  const { t } = useDashboardLang();
  return (
    <section role="alert" aria-labelledby="unreachable-title" className={styles.panel}>
      <h2 id="unreachable-title" className={styles.title}>
        <DashIcon name="alert" size={16} /> {t.unreachableTitle}
      </h2>
      <p className={styles.text}>{t.unreachableText}</p>
      {kept && <p className={styles.text}>{t.unreachableKept}</p>}
      <div>
        <button type="button" className={styles.retry} onClick={retryBootstrap}>
          {t.retry}
        </button>
      </div>
    </section>
  );
};

export default ServerUnreachable;
