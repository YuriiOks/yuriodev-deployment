import React from 'react';
import type { ProviderLogo } from '../../../services/dashboards/financeApi';
import { markOf } from '../../../services/dashboards/providerBrand';
import { brandStyle } from './brandStyle';
import styles from './Money.module.css';

/**
 * A bank's small tile: its square icon when the server sends one, else one letter in its brand colours (neutral for a bank we have no
 * colours for). Decorative: the bank's name is beside it.
 */
const BankMark: React.FC<{ provider: string; logo?: ProviderLogo | null }> = ({ provider, logo }) =>
  logo?.mark ? (
    <span aria-hidden="true" className={styles.bankIcon}>
      <img src={logo.mark} alt="" draggable={false} />
    </span>
  ) : (
    <span aria-hidden="true" className={styles.bankMark} style={brandStyle(provider, logo)}>
      {markOf(provider)}
    </span>
  );

export default BankMark;
