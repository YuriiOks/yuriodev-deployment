import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import type { Evidence, Recurring, Upcoming, UpcomingItem } from '../../../services/dashboards/recurringApi';
import { cx } from '../../../utils/cx';
import Amount from './Amount';
import EndedPlans from './EndedPlans';
import RecurringIcon from './RecurringIcon';
import TruthMark from './TruthMark';
import { splitDue, truthOf, TRUTHS } from './evidenceModel';
import { dayHeading, endedOf, WINDOWS } from './recurringLabels';
import styles from './Recurring.module.css';

/** Whether the paying account can cover a payment, in words (never colour alone). */
function coverWords(item: UpcomingItem, lang: string, r: ReturnType<typeof useDashboardLang>['t']['money']['rec']): string {
  if (item.covered === true) return r.covered;
  if (item.covered === false) return item.shortfall !== null && item.accountCurrency ? fill(r.short, { amount: formatMinor(item.shortfall, item.accountCurrency, lang as 'ru' | 'en') }) : r.notCovered;
  return r.coverUnknown;
}

const UpcomingRow: React.FC<{ item: UpcomingItem; evidence: Evidence | null; accounts: readonly FinanceAccount[]; mode: MoneyDisplay }> = ({ item, evidence, accounts, mode }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const account = item.accountId ? accounts.find((row) => row.id === item.accountId) : undefined;
  const payer = account ? fill(r.paidFrom, { account: account.name }) : item.paymentMethod;
  return (
    <li className={styles.due} data-covered={item.covered === null ? 'unknown' : String(item.covered)} data-overdue={item.overdue ? 'true' : undefined}>
      <RecurringIcon name={item.name} iconUrl={item.iconUrl} color={item.color} />
      <span className={styles.dueMain}>
        <strong className={styles.dueName}>{item.name}</strong>
        <span className={styles.note}>
          {[r.kinds[item.kind], payer, coverWords(item, lang, r)].filter(Boolean).join(' · ')}
        </span>
        {/* The shortfall above is this payment's own missing part; when earlier payments from the same account add to it, the account's whole gap is said too. */}
        {item.covered === false && item.accountShortTotal !== null && item.shortfall !== null && item.accountShortTotal > item.shortfall && item.accountCurrency && (
          <span className={styles.note}>{fill(r.shortTotal, { amount: formatMinor(item.accountShortTotal, item.accountCurrency, lang as 'ru' | 'en') })}</span>
        )}
        <TruthMark evidence={evidence} />
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
  /** The payments, for how far each is verified and which plans have ended by their schedule. */
  recurring: readonly Recurring[];
  mode: MoneyDisplay;
}

/** The "Upcoming payments" body: the window switch, the payments grouped by day, and the totals the server added up. */
const MoneyUpcoming: React.FC<MoneyUpcomingProps> = ({ data, days, onDays, accounts, recurring, mode }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  // By default the next 7 days, at most 8 rows (when nothing falls in the week, the first few that follow); "Show all" opens the whole window.
  const [all, setAll] = useState(false);
  const byId = new Map(recurring.map((row) => [row.id, row]));
  // What its own schedule has finished is not due: it is listed apart.
  const items = data.items.filter((item) => byId.get(item.recurringId)?.scheduleState !== 'ended_by_schedule');
  const week = items.filter((item) => item.daysUntil <= UPCOMING_WEEK_DAYS);
  const bounded = (week.length > 0 ? week : items.slice(0, UPCOMING_FALLBACK_ROWS)).slice(0, UPCOMING_ROWS);
  const visible = all ? items : bounded;
  const groups: { date: string; daysUntil: number; overdue: boolean; items: UpcomingItem[] }[] = [];
  for (const item of visible) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.dueDate && last.overdue === item.overdue) last.items.push(item);
    else groups.push({ date: item.dueDate, daysUntil: item.daysUntil, overdue: item.overdue, items: [item] });
  }
  const split = splitDue(items, (id) => truthOf(byId.get(id)?.evidence ?? null), mode);
  // A grand total (and its "≈") is only for a window that has something converted in it; one currency is one figure, told once.
  const showGrand = mode === 'base' && data.grand !== null && data.totals.some((total) => total.converted && total.display !== null);
  const single = !showGrand && data.totals.length === 1 ? data.totals[0] : null;
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
      {items.length === 0 ? (
        <p className={styles.none}>{fill(r.upcomingNone, { days })}</p>
      ) : (
        <>
          <ol className={styles.days}>
            {groups.map((group) => (
              <li key={group.date} className={styles.day}>
                <h3 className={styles.dayHead}>{dayHeading(group.date, group.daysUntil, lang, r, group.overdue)}</h3>
                <ul className={styles.dueList}>
                  {group.items.map((item, index) => (
                    <UpcomingRow key={`${item.recurringId}-${index}`} item={item} evidence={byId.get(item.recurringId)?.evidence ?? null} accounts={accounts} mode={mode} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {items.length > visible.length || all ? (
            <button type="button" className={styles.more} aria-expanded={all} onClick={() => setAll((on) => !on)}>
              {all ? r.showFewer : fill(r.showAllN, { n: items.length })}
            </button>
          ) : null}
          <div className={styles.dueTotals}>
            <span className={styles.note}>{r.dueTotals}</span>
            {showGrand && data.grand && (
              <strong className={styles.grandDue}>
                {r.dueGrand}: ≈ {formatMinor(data.grand.amount, data.grand.currency, lang)}
              </strong>
            )}
            {single ? (
              <strong className={styles.grandDue}>
                {r.dueGrand}: {formatMinor(single.amount, single.currency, lang)}
              </strong>
            ) : (
              <ul className={styles.totalList}>
                {data.totals.map((total) => (
                  <li key={total.currency}>{formatMinor(total.amount, total.currency, lang)}</li>
                ))}
              </ul>
            )}
            {showGrand && data.grand && !data.grand.complete && <span className={styles.note}>{r.dueIncomplete}</span>}
            <ul className={styles.dueSplit}>
              {TRUTHS.flatMap((truth) => {
                const sums = split[truth];
                if (sums.length === 0) return [];
                const amount = sums.map((sum) => `${sum.approx ? '≈ ' : ''}${formatMinor(sum.amount, sum.currency, lang)}`).join(' · ');
                const template = truth === 'confirmed' ? r.dueSplit.confirmed : truth === 'none_seen' ? r.dueSplit.noneSeen : r.dueSplit.unchecked;
                return [
                  <li key={truth} data-truth={truth}>
                    {fill(template, { amount })}
                  </li>,
                ];
              })}
            </ul>
          </div>
        </>
      )}
      <EndedPlans rows={endedOf(recurring, false)} />
    </div>
  );
};

export default MoneyUpcoming;
