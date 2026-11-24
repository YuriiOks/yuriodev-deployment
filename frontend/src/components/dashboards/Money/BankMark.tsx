import React from 'react';
import { useImageFallback } from '../../../hooks/useImageFallback';
import type { ProviderLogo } from '../../../services/dashboards/financeApi';
import { markOf } from '../../../services/dashboards/providerBrand';
import { brandStyle } from './brandStyle';
import styles from './Money.module.css';

/**
 * A bank's small tile: its square icon when the server sends one, else one letter in its brand colours (neutral for a bank we have no
 * colours for). Decorative: the bank's name is beside it.
 */
const BankMark: React.FC<{ provider: string; logo?: ProviderLogo | null }> = ({ provider, logo }) => {
  const image = useImageFallback(logo?.mark);
  // A mark that cannot be loaded gives way to the letter tile at once, and is asked for once more a few seconds later.
  return logo?.mark && !image.failed ? (
    <span ref={image.ref} aria-hidden="true" className={styles.bankIcon}>
      <img key={image.attempt} src={image.ready ? logo.mark : undefined} alt="" decoding="async" draggable={false} onLoad={image.onLoad} onError={image.onError} />
    </span>
  ) : (
    <span aria-hidden="true" className={styles.bankMark} style={brandStyle(provider, logo)}>
      {markOf(provider)}
    </span>
  );
};

export default BankMark;
