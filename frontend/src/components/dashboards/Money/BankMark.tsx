import React from 'react';
import { markOf } from '../../../services/dashboards/providerBrand';
import { brandStyle } from './brandStyle';
import styles from './Money.module.css';

/** A bank's mark: one letter in its brand colours (neutral for a bank we have no colours for). Decorative: the bank's name is beside it. */
const BankMark: React.FC<{ provider: string }> = ({ provider }) => (
  <span aria-hidden="true" className={styles.bankMark} style={brandStyle(provider)}>
    {markOf(provider)}
  </span>
);

export default BankMark;
