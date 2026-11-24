import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import type { Upcoming, UpcomingItem } from '../../../services/dashboards/recurringApi';
import { cx } from '../../../utils/cx';
import Amount from './Amount';
import RecurringIcon from './RecurringIcon';
import { dayHeading, WINDOWS } from './recurringLabels';
import styles from './Recurring.module.css';

/** Whether the paying account can cover a payment, in words (never colour alone). */
function coverWords(item: UpcomingItem, lang: string, r: ReturnType<typeof useDashboardLang>['t']['money']['rec']): string {
  if (item.covered === true) return r.covered;
  if (item.covered === false) return item.shortfall !== null && item.accountCurrency ? fill(r.short, { amount: formatMinor(item.shortfall, item.accountCurrency, lang as 'ru' | 'en') }) : r.notCovered;
  return r.coverUnknown;
}

const UpcomingRow: React.FC<{ item: UpcomingItem; accounts: readonly FinanceAccount[]; mode: MoneyDisplay }> = ({ item, accounts, mode }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const account = item.accountId ? accounts.find((row) => row.id === item.accountId) : undefined;
  const payer = account ? fill(r.paidFrom, { account: account.name }) : item.paymentMethod;
  return (
    <li className={styles.due} data-covered={item.covered === null ? 'unknown' : String(item.covered)}>
      <RecurringIcon name={item.name} iconUrl={item.iconUrl} color={item.color} />
      <span className={styles.dueMain}>
        <strong className={styles.dueName}>{item.name}</strong>
        <span className={styles.note}>
          {[r.kinds[item.kind], payer, coverWords(item, lang, r)].filter(Boolean).join(' · ')}
        </span>
      </span>
      <strong className={styles.dueAmount}>
        <Amount amount={item.amount} currency={item.currency} display={item.display} mode={mode} />
      </strong>
    </li>
  );
};

/** The default view: payments due within this many days from today (today is day 0)... */
const UPCOMING_WEEK_DAYS = 6;
/** ...at most this many rows, and when nothing is due that week, this many of the next ones. */
const UPCOMING_ROWS = 8;
const UPCOMING_FALLBACK_ROWS = 3;

export interface MoneyUpcomingProps {
  data: Upcoming;
  days: number;
  onDays: (days: number) => void;
  accounts: readonly FinanceAccount[];
  mode: MoneyDisplay;
}

/** The "Upcoming payments" body: the window switch, the payments grouped by day, and the totals the server added up. */
const MoneyUpcoming: React.FC<MoneyUpcomingProps> = ({ data, days, onDays, accounts, mode }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  // By default the next 7 days, at most 8 rows (when nothing falls in the week, the first few that follow); "Show all" opens the whole window.
  const [all, setAll] = useState(false);
  const week = data.items.filter((item) => item.daysUntil <= UPCOMING_WEEK_DAYS);
  const bounded = (week.length > 0 ? week : data.items.slice(0, UPCOMING_FALLBACK_ROWS)).slice(0, UPCOMING_ROWS);
  const visible = all ? data.items : bounded;
  const groups: { date: string; daysUntil: number; items: UpcomingItem[] }[] = [];
  for (const item of visible) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.dueDate) last.items.push(item);
    else groups.push({ date: item.dueDate, daysUntil: item.daysUntil, items: [item] });
  }
  const showGrand = mode === 'base' && data.grand !== null && data.totals.some((total) => total.display !== null);
  return (
    <div className={styles.body}>
      <div className={styles.toolbar}>
        <div role="group" aria-label={r.windowLabel} className={styles.segment}>
          {WINDOWS.map((choice) => (
            <button key={choice} type="button" className={cx(styles.segmentOption, days === choice && styles.segmentOn)} aria-pressed={days === choice} onClick={() => onDays(choice)}>
              {fill(r.windowDays, { n: choice })}
            </button>
          ))}
        </div>
        <Link className={styles.secondary} to="?view=recurring">
          {r.allRecurring}
        </Link>
      </div>
      {groups.length === 0 ? (
        <p className={styles.none}>{fill(r.upcomingNone, { days })}</p>
      ) : (
        <>
          <ol className={styles.days}>
            {groups.map((group) => (
              <li key={group.date} className={styles.day}>
                <h3 className={styles.dayHead}>{dayHeading(group.date, group.daysUntil, lang, r)}</h3>
                <ul className={styles.dueList}>
                  {group.items.map((item, index) => (
                    <UpcomingRow key={`${item.recurringId}-${index}`} item={item} accounts={accounts} mode={mode} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {data.items.length > visible.length || all ? (
            <button type="button" className={styles.more} aria-expanded={all} onClick={() => setAll((on) => !on)}>
              {all ? r.showFewer : fill(r.showAllN, { n: data.items.length })}
            </button>
          ) : null}
          <div className={styles.dueTotals}>
            <span className={styles.note}>{r.dueTotals}</span>
            {showGrand && data.grand && (
              <strong className={styles.grandDue}>
                {r.dueGrand}: ≈ {formatMinor(data.grand.amount, data.grand.currency, lang)}
              </strong>
            )}
            <ul className={styles.totalList}>
              {data.totals.map((total) => (
                <li key={total.currency}>{formatMinor(total.amount, total.currency, lang)}</li>
              ))}
            </ul>
            {showGrand && data.grand && !data.grand.complete && <span className={styles.note}>{r.dueIncomplete}</span>}
          </div>
        </>
      )}
    </div>
  );
};

export default MoneyUpcoming;
