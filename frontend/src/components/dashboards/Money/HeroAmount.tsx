import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { formatMinorParts } from '../../../services/dashboards/money';
import styles from './Money.module.css';

export interface HeroAmountProps {
  amount: number;
  currency: string;
  /** Mark it as an approximation ("≈", spoken as "approximately"). */
  approx?: boolean;
}

/**
 * A balance as the card's hero: the pounds large and bold, the currency symbol and the pence smaller beside them, a minus sign for a
 * negative figure. The text it adds up to is the plain formatted amount, so a screen reader reads it as one.
 */
const HeroAmount: React.FC<HeroAmountProps> = ({ amount, currency, approx = false }) => {
  const { t, lang } = useDashboardLang();
  return (
    <span className={styles.hero} data-hero>
      {approx && (
        <>
          <span className="sr-only">{t.money.approximately} </span>
          <span aria-hidden="true" className={styles.heroSmall}>
            ≈{' '}
          </span>
        </>
      )}
      {formatMinorParts(amount, currency, lang).map((part, index) => (
        <span key={index} data-part={part.kind} className={part.kind === 'symbol' || part.kind === 'frac' ? styles.heroSmall : styles.heroBig}>
          {part.text}
        </span>
      ))}
    </span>
  );
};

export default HeroAmount;
