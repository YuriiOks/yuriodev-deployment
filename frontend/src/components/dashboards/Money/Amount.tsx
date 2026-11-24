import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import type { Converted } from '../../../services/dashboards/financeApi';
import type { Shown } from '../../../services/dashboards/display';
import { formatMinor } from '../../../services/dashboards/money';
import type { MoneyDisplay } from '../../../services/dashboards/preferences';
import styles from './Money.module.css';

export interface AmountProps {
  amount: number;
  currency: string;
  /** The server's conversion into the display currency, when it has one. */
  display?: Converted | null;
  mode: MoneyDisplay;
  /** A "+" for money in and a "-" for money out (transactions). */
  signed?: boolean;
}

/**
 * An amount as the page shows it. In pounds mode a converted figure is marked "≈" and the original stands small beside it (an
 * amount already in pounds, or in a currency the server has no rate for, is shown plainly as it is); in the account currency
 * mode it is always the original.
 */
const Amount: React.FC<AmountProps> = ({ amount, currency, display, mode, signed = false }) => {
  const { t, lang } = useDashboardLang();
  const original = formatMinor(amount, currency, lang, { signed });
  if (mode === 'native' || !display || display.currency === currency) return <>{original}</>;
  return (
    <>
      <span className="sr-only">{t.money.approximately} </span>
      <span aria-hidden="true">≈ </span>
      {formatMinor(display.amount, display.currency, lang, { signed })} <small className={styles.original}>{original}</small>
    </>
  );
};

/** A summed figure (`Shown`): "≈" and the originals beside it when it was converted. */
export const ShownAmount: React.FC<{ shown: Shown }> = ({ shown }) => {
  const { t, lang } = useDashboardLang();
  const value = formatMinor(shown.amount, shown.currency, lang);
  if (!shown.approx) return <>{value}</>;
  return (
    <>
      <span className="sr-only">{t.money.approximately} </span>
      <span aria-hidden="true">≈ </span>
      {value}
    </>
  );
};

export default Amount;
