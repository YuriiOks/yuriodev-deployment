import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import type { Converted } from '../../../services/dashboards/financeApi';
import type { Shown } from '../../../services/dashboards/display';
import { APPROX, formatMinor } from '../../../services/dashboards/money';
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
/** The mark of a converted figure: "≈" for the eye, "approximately" for a screen reader. The one place that draws it. */
export const Approx: React.FC<{ tight?: boolean }> = ({ tight = false }) => {
  const { t } = useDashboardLang();
  return (
    <>
      <span className="sr-only">{t.money.approximately} </span>
      <span aria-hidden="true">{tight ? '\u2248' : APPROX}</span>
    </>
  );
};

const Amount: React.FC<AmountProps> = ({ amount, currency, display, mode, signed = false }) => {
  const { lang } = useDashboardLang();
  const original = formatMinor(amount, currency, lang, { signed });
  // A figure converted to nothing (a few pence) is told as the original, never as "≈ £0.00".
  if (mode === 'native' || !display || display.currency === currency || (display.amount === 0 && amount !== 0)) return <>{original}</>;
  return (
    <>
      <Approx />
      {formatMinor(display.amount, display.currency, lang, { signed })} <small className={styles.original}>{original}</small>
    </>
  );
};

/** A summed figure (`Shown`): "≈" and the originals beside it when it was converted. */
export const ShownAmount: React.FC<{ shown: Shown }> = ({ shown }) => {
  const { lang } = useDashboardLang();
  const value = formatMinor(shown.amount, shown.currency, lang);
  if (!shown.approx) return <>{value}</>;
  return (
    <>
      <Approx />
      {value}
    </>
  );
};

export default Amount;
