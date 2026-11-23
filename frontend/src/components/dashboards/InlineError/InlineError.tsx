import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import DashIcon from '../DashIcon/DashIcon';
import styles from './InlineError.module.css';

export interface InlineErrorProps {
  message: string;
  /** Shows a "Try again" button that calls it. */
  onRetry?: () => void;
}

/** A quiet error line: an alert icon and the words in the danger colour, with a retry when there is one. */
const InlineError: React.FC<InlineErrorProps> = ({ message, onRetry }) => {
  const { t } = useDashboardLang();
  return (
    <div role="alert" className={styles.error}>
      <DashIcon name="alert" size={14} />
      <span>{message}</span>
      {onRetry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          {t.retry}
        </button>
      )}
    </div>
  );
};

export default InlineError;
