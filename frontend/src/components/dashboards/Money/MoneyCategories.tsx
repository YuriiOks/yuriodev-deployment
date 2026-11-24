import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { CurrencyCategories, FinanceCategories } from '../../../services/dashboards/financeApi';
import { formatMinor } from '../../../services/dashboards/money';
import { monthName } from './labels';
import styles from './Money.module.css';

const CurrencyBlock: React.FC<{ block: CurrencyCategories; month: string; previousMonth: string }> = ({ block, month, previousMonth }) => {
  const { t, lang } = useDashboardLang();
  const m = t.money;
  const previous = monthName(previousMonth, lang);
  let change = '';
  if (block.previousSpent > 0) {
    const percent = Math.round((Math.abs(block.spent - block.previousSpent) / block.previousSpent) * 100);
    change = percent === 0 ? fill(m.spendSame, { previous }) : fill(block.spent < block.previousSpent ? m.spendLess : m.spendMore, { percent, previous });
  }
  const rows = block.categories.filter((row) => row.spent > 0).sort((a, b) => b.spent - a.spent);
  return (
    <div className={styles.spendCurrency}>
      <p className={styles.spendHead}>
        {[monthName(month, lang), `${block.currency} ${formatMinor(block.spent, block.currency, lang)}`, change].filter(Boolean).join(' · ')}
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
                  <strong>{formatMinor(row.spent, block.currency, lang)}</strong> · {share}%
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
const MoneyCategories: React.FC<{ data: FinanceCategories }> = ({ data }) => {
  const { t } = useDashboardLang();
  const blocks = data.currencies.filter((block) => block.spent > 0);
  return (
    <div className={styles.spend}>
      {blocks.length === 0 && <p className={styles.none}>{t.money.spendNothing}</p>}
      {blocks.map((block) => (
        <CurrencyBlock key={block.currency} block={block} month={data.month} previousMonth={data.previousMonth} />
      ))}
      <p className={styles.spendNote}>{t.money.spendNote}</p>
    </div>
  );
};

export default MoneyCategories;
