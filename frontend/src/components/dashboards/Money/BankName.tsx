import React from 'react';
import type { ProviderLogo } from '../../../services/dashboards/financeApi';
import { brandOf } from '../../../services/dashboards/providerBrand';
import { providerName } from './providers';
import styles from './Money.module.css';

export interface BankNameProps {
  provider: string;
  logo: ProviderLogo | null | undefined;
}

/**
 * A bank's name: its official wordmark image when the server provides one, otherwise the text. The text is always there as the
 * accessible name (the image is decorative). A known brand card is dark, so it takes the logo made for dark backgrounds; a neutral
 * card takes the one for the page's theme (the stylesheet shows the right one). No brand fonts or logo files live in the repo: the
 * wordmark image carries the typeface.
 */
const BankName: React.FC<BankNameProps> = ({ provider, logo }) => {
  const name = providerName(provider);
  if (!logo) return <>{name}</>;
  const onDark = logo.dark ?? logo.light;
  const onLight = logo.light ?? logo.dark;
  const brandCard = brandOf(provider) !== null;
  return (
    <>
      <span className="sr-only">{name}</span>
      <span aria-hidden="true" className={styles.logos} data-surface={brandCard ? 'dark' : 'theme'}>
        {onDark && <img className={styles.logoOnDark} src={onDark} alt="" draggable={false} />}
        {onLight && !brandCard && <img className={styles.logoOnLight} src={onLight} alt="" draggable={false} />}
      </span>
    </>
  );
};

export default BankName;
