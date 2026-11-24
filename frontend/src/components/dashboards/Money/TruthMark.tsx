import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { Evidence } from '../../../services/dashboards/recurringApi';
import DashIcon from '../DashIcon/DashIcon';
import { dayLabel } from './labels';
import { truthOf } from './evidenceModel';
import styles from './Recurring.module.css';

/**
 * A small mark that says how far a payment is verified, always in words: "confirmed by the bank" (the bank's own lines matched it, with the
 * last matched date), "no charge seen" (its paying account is collected and nothing matched) or "from your list, not checked" (no account
 * of ours pays it, so it is only the owner's note).
 */
const TruthMark: React.FC<{ evidence: Evidence | null }> = ({ evidence }) => {
  const { t, lang } = useDashboardLang();
  const x = t.money.rec.truth;
  const truth = truthOf(evidence);
  const words = truth === 'confirmed' ? (evidence?.lastMatchedOn ? fill(x.confirmedOn, { date: dayLabel(evidence.lastMatchedOn, lang) }) : x.confirmed) : truth === 'none_seen' ? x.noneSeen : x.unchecked;
  return (
    <span className={styles.truth} data-truth={truth}>
      {truth === 'confirmed' && <DashIcon name="check" size={14} />}
      {truth === 'none_seen' && <DashIcon name="alert" size={14} />}
      {words}
    </span>
  );
};

export default TruthMark;
