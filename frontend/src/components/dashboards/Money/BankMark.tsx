import React from 'react';
import { brandOf, markOf } from '../../../services/dashboards/providerBrand';
import styles from './Money.module.css';

/** The CSS custom properties a bank's colours travel in: its brand pair, or none (the neutral card takes over in the stylesheet). */
export function brandStyle(provider: string): React.CSSProperties | undefined {
  const brand = brandOf(provider);
  return brand ? ({ '--bank-bg': brand.bg, '--bank-fg': brand.fg } as React.CSSProperties) : undefined;
}

/** A bank's mark: one letter in its brand colours (neutral for a bank we have no colours for). Decorative: the bank's name is beside it. */
const BankMark: React.FC<{ provider: string }> = ({ provider }) => (
  <span aria-hidden="true" className={styles.bankMark} style={brandStyle(provider)}>
    {markOf(provider)}
  </span>
);

export default BankMark;
