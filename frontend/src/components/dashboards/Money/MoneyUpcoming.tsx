import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { FinanceAccount, ProviderLogo } from '../../../services/dashboards/financeApi';
import { APPROX, formatMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import type { Evidence, Recurring, Upcoming, UpcomingItem } from '../../../services/dashboards/recurringApi';
import { cx } from '../../../utils/cx';
import Amount, { Approx } from './Amount';
import EndedPlans from './EndedPlans';
import DashIcon from '../DashIcon/DashIcon';
import RecurringIcon from './RecurringIcon';
import TruthMark from './TruthMark';
import { splitDue, truthOf, TRUTHS } from './evidenceModel';
import { dayLabel } from './labels';
import { dayHeading, endedOf, WINDOWS } from './recurringLabels';
import styles from './Recurring.module.css';

/**
 * What a row says of its paying account, in words (never colour alone): nothing when it can cover the payment (the ordinary case needs no
 * word) or when no account of ours pays it; "cover unknown" only for a linked account the server could not judge; the shortfall as the account's state.
 */
function coverWords(item: UpcomingItem, lang: string, r: ReturnType<typeof useDashboardLang>['t']['money']['rec']): string {
  if (item.covered === false) return item.shortfall !== null && item.accountCurrency ? fill(r.short, { amount: formatMinor(item.shortfall, item.accountCurrency, lang as 'ru' | 'en') }) : r.notCovered;
  if (item.covered === null && item.accountId) return r.coverUnknown;
  return '';
}

const UpcomingRow: React.FC<{ item: UpcomingItem; evidence: Evidence | null; accounts: readonly FinanceAccount[]; logos: Readonly<Record<string, ProviderLogo>>; mode: MoneyDisplay }> = ({ item, evidence, accounts, logos, mode }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  const account = item.accountId ? accounts.find((row) => row.id === item.accountId) : undefined;
  // A payment with no picture of its own and no colour of its own wears its paying bank's colour pair, when the server gives one.
  const pair = !item.iconUrl && !item.color && account ? (logos[account.provider]?.colors ?? null) : null;
  const payer = account ? fill(r.paidFrom, { account: account.name }) : item.paymentMethod;
  return (
    <li className={styles.due} data-covered={item.covered === null ? 'unknown' : String(item.covered)} data-overdue={item.overdue ? 'true' : undefined}>
      <RecurringIcon name={item.name} iconUrl={item.iconUrl} color={item.color} pair={pair} />
      <span className={styles.dueMain}>
        <span className={styles.dueLine}>
          <strong className={styles.dueName}>{item.name}</strong>
          <span className={styles.note}>{[r.kinds[item.kind], payer].filter(Boolean).join(' · ')}</span>
          {item.covered === false && (
            <span className={styles.shortChip}>
              <DashIcon name="alert" size={14} />
              {coverWords(item, lang, r)}
            </span>
          )}
          {item.covered === null && item.accountId && <span className={styles.note}>{coverWords(item, lang, r)}</span>}
        </span>
        {/* The shortfall above is this payment's own missing part; when earlier payments from the same account add to it, the account's whole gap is said too. */}
        {item.covered === false && item.accountShortTotal !== null && item.shortfall !== null && item.accountShortTotal > item.shortfall && item.accountCurrency && (
          <span className={styles.note}>{fill(r.shortTotal, { amount: formatMinor(item.accountShortTotal, item.accountCurrency, lang as 'ru' | 'en') })}</span>
        )}
      </span>
      <span className={styles.dueEnd}>
        <TruthMark evidence={evidence} compact />
        <strong className={styles.dueAmount}>
          <Amount amount={item.amount} currency={item.currency} display={item.display} mode={mode} />
        </strong>
      </span>
    </li>
  );
};

/** What a day's payments add up to, per currency (converted into the display currency, marked approximate, in pounds mode where the server converted them). */
function daySums(items: readonly UpcomingItem[], mode: MoneyDisplay): { amount: number; currency: string; approx: boolean }[] {
  const sums = new Map<string, { amount: number; currency: string; approx: boolean }>();
  for (const item of items) {
    const converted = mode === 'base' && item.display !== null && item.display.currency !== item.currency;
    const figure = converted && item.display ? { amount: item.display.amount, currency: item.display.currency, approx: true } : { amount: item.amount, currency: item.currency, approx: false };
    const before = sums.get(figure.currency);
    sums.set(figure.currency, { amount: (before?.amount ?? 0) + figure.amount, currency: figure.currency, approx: (before?.approx ?? false) || figure.approx });
  }
  return [...sums.values()];
}

/** The rows shown at once; the rest of the window is behind "Show N more". */
const UPCOMING_ROWS = 8;

/** The 14 or 30 days choice and the link to all payments: always there, also while the answer is loading or failed, so the window can be changed out of a failure. */
export const UpcomingToolbar: React.FC<{ days: number; onDays: (days: number) => void }> = ({ days, onDays }) => {
  const { t } = useDashboardLang();
  const r = t.money.rec;
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
    </div>
  );
};

/** How many days an answer spans (its first and last day), to tell whether it is for the window that is chosen. */
function spanDays(data: Upcoming): number | null {
  const from = Date.parse(`${data.from}T12:00:00`);
  const to = Date.parse(`${data.to}T12:00:00`);
  return Number.isNaN(from) || Number.isNaN(to) ? null : Math.round((to - from) / 86400000);
}

export interface MoneyUpcomingProps {
  data: Upcoming;
  days: number;
  accounts: readonly FinanceAccount[];
  /** The payments, for how far each is verified and which plans have ended by their schedule. */
  recurring: readonly Recurring[];
  /** The banks' logos answer: its colours tint a payment's letter tile. */
  logos: Readonly<Record<string, ProviderLogo>>;
  mode: MoneyDisplay;
}

/** The "Upcoming payments" body: the window switch, the payments grouped by day, and the totals the server added up. */
const MoneyUpcoming: React.FC<MoneyUpcomingProps> = ({ data, days, accounts, recurring, logos, mode }) => {
  const { t, lang } = useDashboardLang();
  const r = t.money.rec;
  // The window switch is the list's range: every payment of the chosen window, the first rows at once and "Show N more" for the rest (the window's total is the sum of all of them).
  const [all, setAll] = useState(false);
  const byId = new Map(recurring.map((row) => [row.id, row]));
  // What its own schedule has finished is not due: it is listed apart.
  const items = data.items.filter((item) => byId.get(item.recurringId)?.scheduleState !== 'ended_by_schedule');
  const visible = all ? items : items.slice(0, UPCOMING_ROWS);
  const groups: { date: string; daysUntil: number; overdue: boolean; items: UpcomingItem[] }[] = [];
  for (const item of visible) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.dueDate && last.overdue === item.overdue) last.items.push(item);
    else groups.push({ date: item.dueDate, daysUntil: item.daysUntil, overdue: item.overdue, items: [item] });
  }
  // The answer on screen is for the other window until the new one arrives: it is dimmed and marked busy, not passed off as the chosen one.
  const span = spanDays(data);
  const busy = span !== null && Math.abs(span - days) > 1;
  const split = splitDue(items, (id) => truthOf(byId.get(id)?.evidence ?? null), mode);
  // A grand total (and its "≈") is only for a window that has something converted in it; one currency is one figure, told once.
  const showGrand = mode === 'base' && data.grand !== null && data.totals.some((total) => total.converted && total.display !== null);
  const single = !showGrand && data.totals.length === 1 ? data.totals[0] : null;
  return (
    <div className={styles.body} aria-busy={busy || undefined} data-busy={busy ? 'true' : undefined}>
      {items.length === 0 ? (
        <p className={styles.none}>{fill(r.upcomingNone, { days })}</p>
      ) : (
        <>
          <ol className={styles.days}>
            {groups.map((group) => {
              const sums = daySums(group.items, mode);
              return (
                <li key={`${group.date}-${group.overdue}`} className={styles.day}>
                  <div className={styles.dayTop}>
                    <h3 className={styles.dayHead}>{dayHeading(group.date, group.daysUntil, lang, r, group.overdue)}</h3>
                    <span className={styles.dayTotal}>{sums.map((sum) => `${sum.approx ? APPROX : ''}${formatMinor(sum.amount, sum.currency, lang)}`).join(' · ')}</span>
                  </div>
                  <ul className={styles.dueList}>
                    {group.items.map((item, index) => (
                      <UpcomingRow key={`${item.recurringId}-${index}`} item={item} evidence={byId.get(item.recurringId)?.evidence ?? null} accounts={accounts} logos={logos} mode={mode} />
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
          {items.length > UPCOMING_ROWS ? (
            <button type="button" className={styles.more} aria-expanded={all} onClick={() => setAll((on) => !on)}>
              {all ? r.showFewer : fill(r.showMoreN, { n: items.length - visible.length })}
            </button>
          ) : null}
          <div className={styles.dueTotals}>
            <span className={styles.note}>
              {r.dueTotals}
              {data.from && data.to ? ` · ${fill(r.dueRange, { from: dayLabel(data.from, lang), to: dayLabel(data.to, lang) })}` : ''}
            </span>
            <div className={styles.dueFigures}>
              {showGrand && data.grand && (
                <strong className={styles.grandDue}>
                  {r.dueGrand}: <Approx />
                  {formatMinor(data.grand.amount, data.grand.currency, lang)}
                </strong>
              )}
              {single && (
                <strong className={styles.grandDue}>
                  {r.dueGrand}: {formatMinor(single.amount, single.currency, lang)}
                </strong>
              )}
              {/* The parts are told as parts ("of which") of a grand total, and not at all when one currency is the whole total. */}
              {!single && showGrand && data.totals.length > 0 && (
                <span className={styles.note}>
                  {r.ofWhich}: {data.totals.map((total) => formatMinor(total.amount, total.currency, lang)).join(' · ')}
                </span>
              )}
              {!single && !showGrand && (
                <ul className={styles.totalList}>
                  {data.totals.map((total) => (
                    <li key={total.currency}>{formatMinor(total.amount, total.currency, lang)}</li>
                  ))}
                </ul>
              )}
              {showGrand && data.grand && !data.grand.complete && <span className={styles.note}>{r.dueIncomplete}</span>}
            </div>
            <ul className={styles.dueSplit}>
              {TRUTHS.flatMap((truth) => {
                const sums = split[truth];
                if (sums.length === 0) return [];
                const amount = sums.map((sum) => `${sum.approx ? APPROX : ''}${formatMinor(sum.amount, sum.currency, lang)}`).join(' · ');
                const template = truth === 'confirmed' ? r.dueSplit.confirmed : truth === 'none_seen' ? r.dueSplit.noneSeen : r.dueSplit.unchecked;
                return [
                  <li key={truth} data-truth={truth}>
                    {fill(template, { amount })}
                  </li>,
                ];
              })}
            </ul>
            {items.some((item) => item.covered === false) && <span className={styles.note}>{r.shortNote}</span>}
          </div>
        </>
      )}
      <EndedPlans rows={endedOf(recurring, false)} />
    </div>
  );
};

export default MoneyUpcoming;
