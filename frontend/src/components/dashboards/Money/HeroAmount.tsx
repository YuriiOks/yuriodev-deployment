import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { formatMinorParts } from '../../../services/dashboards/money';
import { Approx } from './Amount';
import styles from './Money.module.css';

export interface HeroAmountProps {
  amount: number;
  currency: string;
  /** Mark it as an approximation ("≈", spoken as "approximately"). */
  approx?: boolean;
}

/**
 * A balance as the card's hero: the pounds large and bold; the sign and the symbol in front of them as one small group, the pence and
 * anything after the digits (a symbol that follows the number in Russian, the space before it) small beside them. The "≈" sits between the
 * two sizes, with a margin and not a space. The text it adds up to is the plain formatted amount, so a screen reader reads it as one.
 */
const HeroAmount: React.FC<HeroAmountProps> = ({ amount, currency, approx = false }) => {
  const { lang } = useDashboardLang();
  const parts = formatMinorParts(amount, currency, lang);
  const firstDigit = parts.findIndex((part) => part.kind === 'int');
  const lead = firstDigit > 0 ? parts.slice(0, firstDigit) : [];
  const rest = firstDigit > 0 ? parts.slice(firstDigit) : parts;
  return (
    <span className={styles.hero} data-hero>
      {approx && (
        <span className={styles.heroApprox}>
          <Approx tight />
        </span>
      )}
      {lead.length > 0 && (
        <span className={styles.heroSmall}>
          {lead.map((part, index) => (
            <span key={index} data-part={part.kind}>
              {part.text}
            </span>
          ))}
        </span>
      )}
      {rest.map((part, index) => (
        <span key={index} data-part={part.kind} className={part.kind === 'int' ? styles.heroBig : styles.heroSmall}>
          {part.text}
        </span>
      ))}
    </span>
  );
};

export default HeroAmount;
