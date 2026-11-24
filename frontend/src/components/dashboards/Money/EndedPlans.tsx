import React, { useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { Recurring } from '../../../services/dashboards/recurringApi';
import { dayLabel } from './labels';
import RecurringIcon from './RecurringIcon';
import TruthMark from './TruthMark';
import styles from './Recurring.module.css';

/** The plans its own schedule has finished, listed apart and collapsed: they are in neither what is due nor what is owed. */
const EndedPlans: React.FC<{ rows: readonly Recurring[] }> = ({ rows }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const id = `money-ended-${rows[0].id}`;
  return (
    <div className={styles.ended}>
      <div className={styles.endedHead}>
        <span className={styles.note}>{fill(r.endedList, { n: rows.length })}</span>
        <button type="button" className={styles.more} aria-expanded={open} aria-controls={id} onClick={() => setOpen((on) => !on)}>
          {open ? r.debtsHide : r.debtsShow}
        </button>
      </div>
      {open && (
        <ul id={id} className={styles.endedList}>
          {rows.map((row) => (
            <li key={row.id} className={styles.endedRow}>
              <RecurringIcon name={row.name} iconUrl={row.iconUrl} color={row.color} />
              <span className={styles.dueMain}>
                <strong className={styles.dueName}>{row.name}</strong>
                <span className={styles.note}>
                  {[r.endedMark, row.nextDate ? dayLabel(row.nextDate, lang) : '', row.creditor ?? ''].filter(Boolean).join(' · ')}
                </span>
                <TruthMark evidence={row.evidence} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default EndedPlans;
