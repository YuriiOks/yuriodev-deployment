import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import styles from './QuickAdd.module.css';

export interface QuickAddProps {
  placeholder: string;
}

/** The quick-add field. Visual only for now: nothing is saved yet, so Enter does nothing. */
const QuickAdd: React.FC<QuickAddProps> = ({ placeholder }) => {
  const { t } = useDashboardLang();
  return (
    <form aria-label={t.quickAdd} className={styles.form} onSubmit={(event) => event.preventDefault()}>
      <span aria-hidden="true" className={styles.prompt}>
        &gt;
      </span>
      <input type="text" aria-label={placeholder} placeholder={placeholder} className={styles.input} />
    </form>
  );
};

export default QuickAdd;
