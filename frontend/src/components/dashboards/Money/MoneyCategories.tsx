import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { CurrencyCategories, FinanceCategories } from '../../../services/dashboards/financeApi';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import { APPROX, formatMinor } from '../../../services/dashboards/money';
import CategoryMark from './CategoryMark';
import { dayLabel, monthName, monthTitle } from './labels';
import styles from './Money.module.css';

const CurrencyBlock: React.FC<{ block: CurrencyCategories; month: string; previousMonth: string; previousDay: string | null; approx?: boolean; showCode?: boolean }> = ({ block, month, previousMonth, previousDay, approx = false, showCode = true }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const previous = monthName(previousMonth, lang);
  // The month so far is told against the month before up to the same day ("by Oct 24"), not against all of it; a month that is over, against all of it.
  const toDate = previousDay !== null && block.previousToDateSpent !== null;
  const base = toDate ? (block.previousToDateSpent ?? 0) : block.previousSpent;
  const date = previousDay ? dayLabel(previousDay, lang) : '';
  let change = '';
  if (base > 0) {
    const percent = Math.round((Math.abs(block.spent - base) / base) * 100);
    const words = toDate ? { same: m.spendSameBy, less: m.spendLessBy, more: m.spendMoreBy } : { same: m.spendSame, less: m.spendLess, more: m.spendMore };
    change = percent === 0 ? fill(words.same, { previous, date }) : fill(block.spent < base ? words.less : words.more, { percent, previous, date });
  }
  const sign = approx ? APPROX : '';
  const rows = block.categories.filter((row) => row.spent > 0).sort((a, b) => b.spent - a.spent);
  // A bar is scaled to the largest category, not to the total, so the list reads as a comparison; the three largest are drawn stronger.
  const largest = rows[0]?.spent ?? 0;
  return (
    <div className={styles.spendCurrency}>
      <p className={styles.spendHead}>
        {[monthTitle(month, lang), `${showCode ? `${block.currency} ` : ''}${sign}${formatMinor(block.spent, block.currency, lang)}`, change].filter(Boolean).join(' · ')}
      </p>
      <ul className={styles.spendList}>
        {rows.map((row, index) => {
          const share = block.spent > 0 ? Math.round((row.spent / block.spent) * 100) : 0;
          const rowBase = toDate ? (row.previousToDate ?? row.previous) : row.previous;
          const delta = row.spent - rowBase;
          return (
            <li key={row.category} className={styles.spendRow} data-category={row.category} data-top={index < 3 ? 'true' : undefined}>
              <CategoryMark category={row.category} variant="tile" />
              <div className={styles.spendBody}>
              <div className={styles.spendTop}>
                <span className={styles.spendName}>{m.categories[row.category]}</span>
                <span className={styles.spendNumbers}>
                  <strong>{sign}{formatMinor(row.spent, block.currency, lang)}</strong> · {share}%
                  {rowBase > 0 && (
                    <>
                      {' · '}
                      {formatMinor(delta, block.currency, lang, { signed: true })} ({toDate ? fill(m.vsPreviousBy, { amount: formatMinor(rowBase, block.currency, lang), date }) : fill(m.vsPrevious, { amount: formatMinor(row.previous, block.currency, lang) })})
                    </>
                  )}
                </span>
              </div>
              <div aria-hidden="true" className={styles.spendBar}>
                <div className={styles.spendFill} style={{ width: `${largest > 0 ? Math.round((row.spent / largest) * 100) : 0}%` }} />
              </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/**
 * Spend by category for the month: one block per currency (never summed across them), a bar per category with its sum, its share and
 * the change from the month before in words and a sign. Transfers between the owner's own accounts and pots are not spending.
 */
const MoneyCategories: React.FC<{ data: FinanceCategories; mode: MoneyDisplay }> = ({ data, mode }) => {
  const { t } = useDashboardLang();
  // In pounds the server's own merged lines are shown (each converted once, so they add up); otherwise one block per currency.
  const merged = mode === 'base' ? data.display : null;
  // A currency with no usable rate is never dropped: its spending stays, in its own currency, after the converted block.
  const blocks = merged ? data.currencies.filter((block) => merged.missing.includes(block.currency) && block.spent > 0) : data.currencies.filter((block) => block.spent > 0);
  // The currency code is told only when more than one block is shown.
  const shown = (merged && merged.spent > 0 ? 1 : 0) + blocks.length;
  return (
    <div className={styles.spend}>
      {merged && merged.spent > 0 && (
        <CurrencyBlock
          block={{ currency: merged.currency, spent: merged.spent, previousSpent: merged.previousSpent, previousToDateSpent: merged.previousToDateSpent, categories: merged.categories, converted: true }}
          month={data.month}
          previousMonth={data.previousMonth}
          previousDay={data.previousToDateDay}
          approx={data.currencies.some((block) => block.converted)}
          showCode={shown > 1}
        />
      )}
      {merged && merged.missing.length > 0 && <p className={styles.spendNote}>{fill(t.money.notConverted, { list: merged.missing.join(', ') })}</p>}
      {(merged ? merged.spent === 0 : true) && blocks.length === 0 && <p className={styles.none}>{t.money.spendNothing}</p>}
      {blocks.map((block) => (
        <CurrencyBlock key={block.currency} block={block} month={data.month} previousMonth={data.previousMonth} previousDay={data.previousToDateDay} showCode={shown > 1} />
      ))}
      <p className={styles.spendNote}>{t.money.spendNote}</p>
    </div>
  );
};

export default MoneyCategories;
