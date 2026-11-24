import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { CurrencyCategories, FinanceCategories } from '../../../services/dashboards/financeApi';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import { formatMinor } from '../../../services/dashboards/money';
import { monthName } from './labels';
import styles from './Money.module.css';

const CurrencyBlock: React.FC<{ block: CurrencyCategories; month: string; previousMonth: string; approx?: boolean }> = ({ block, month, previousMonth, approx = false }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const previous = monthName(previousMonth, lang);
  let change = '';
  if (block.previousSpent > 0) {
    const percent = Math.round((Math.abs(block.spent - block.previousSpent) / block.previousSpent) * 100);
    change = percent === 0 ? fill(m.spendSame, { previous }) : fill(block.spent < block.previousSpent ? m.spendLess : m.spendMore, { percent, previous });
  }
  const sign = approx ? '≈ ' : '';
  const rows = block.categories.filter((row) => row.spent > 0).sort((a, b) => b.spent - a.spent);
  return (
    <div className={styles.spendCurrency}>
      <p className={styles.spendHead}>
        {[monthName(month, lang), `${block.currency} ${sign}${formatMinor(block.spent, block.currency, lang)}`, change].filter(Boolean).join(' · ')}
      </p>
      <ul className={styles.spendList}>
        {rows.map((row) => {
          const share = block.spent > 0 ? Math.round((row.spent / block.spent) * 100) : 0;
          const delta = row.spent - row.previous;
          return (
            <li key={row.category} className={styles.spendRow} data-category={row.category}>
              <div className={styles.spendTop}>
                <span className={styles.spendName}>{m.categories[row.category]}</span>
                <span className={styles.spendNumbers}>
                  <strong>{sign}{formatMinor(row.spent, block.currency, lang)}</strong> · {share}%
                  {row.previous > 0 && <> · {formatMinor(delta, block.currency, lang, { signed: true })} ({fill(m.vsPrevious, { amount: formatMinor(row.previous, block.currency, lang) })})</>}
                </span>
              </div>
              <div aria-hidden="true" className={styles.spendBar}>
                <div className={styles.spendFill} style={{ width: `${share}%` }} />
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
  return (
    <div className={styles.spend}>
      {merged && merged.spent > 0 && (
        <CurrencyBlock
          block={{ currency: merged.currency, spent: merged.spent, previousSpent: merged.previousSpent, categories: merged.categories, converted: true }}
          month={data.month}
          previousMonth={data.previousMonth}
          approx={data.currencies.some((block) => block.converted)}
        />
      )}
      {merged && merged.missing.length > 0 && <p className={styles.spendNote}>{fill(t.money.notConverted, { list: merged.missing.join(', ') })}</p>}
      {(merged ? merged.spent === 0 : true) && blocks.length === 0 && <p className={styles.none}>{t.money.spendNothing}</p>}
      {blocks.map((block) => (
        <CurrencyBlock key={block.currency} block={block} month={data.month} previousMonth={data.previousMonth} />
      ))}
      <p className={styles.spendNote}>{t.money.spendNote}</p>
    </div>
  );
};

export default MoneyCategories;
