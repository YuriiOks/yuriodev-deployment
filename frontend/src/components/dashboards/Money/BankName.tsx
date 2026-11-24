import React, { useState } from 'react';
import type { ProviderLogo } from '../../../services/dashboards/financeApi';
import { brandFor, prefersWhiteInk } from '../../../services/dashboards/providerBrand';
import { bankLabel } from './providers';
import styles from './Money.module.css';

export interface BankNameProps {
  provider: string;
  /** The wordmark images from GET /finance/providers, when the server has them. */
  logo: ProviderLogo | null | undefined;
  /** `card` (a wallet card or the opened bank's header) or `chip` (a filter chip: smaller). */
  size?: 'card' | 'chip';
}

/**
 * A bank's name: its official wordmark image when the server provides one, otherwise the text. The text is always there as the accessible
 * name (the image is decorative). The variant follows the card's real background: a known brand card takes white ink on a dark colour and
 * dark ink on a light one (by luminance, not by theme); a neutral card follows the page's theme (its chip is dark in the dark theme, light
 * in the light one). Wordmarks differ in shape: a square mark (about 1:1) is shown taller than a wide one so it does not shrink to nothing.
 * No brand fonts or logo files live in the repo: the image carries the typeface.
 */
const BankName: React.FC<BankNameProps> = ({ provider, logo, size = 'card' }) => {
  const [square, setSquare] = useState(false);
  const name = bankLabel(provider, logo);
  if (!logo || (!logo.onDark && !logo.onLight)) return <>{name}</>;
  // A chip sits on the theme's own surface, not on a brand colour, so it follows the theme like a neutral card.
  const brand = size === 'chip' ? null : brandFor(provider, logo);
  const watch = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) setSquare(naturalWidth / naturalHeight < 1.6);
  };
  const dark = logo.onDark ?? logo.onLight;
  const light = logo.onLight ?? logo.onDark;
  // A brand card is one colour: pick by its luminance. A neutral card shows both and the stylesheet picks by theme.
  const single = brand ? (prefersWhiteInk(brand.bg) ? dark : light) : null;
  return (
    <>
      <span className="sr-only">{name}</span>
      <span aria-hidden="true" className={styles.logos} data-surface={brand ? 'brand' : 'theme'} data-shape={square ? 'square' : 'wide'} data-size={size}>
        {single ? (
          <img className={styles.logoOnDark} src={single} alt="" draggable={false} onLoad={watch} />
        ) : (
          <>
            {dark && <img className={styles.logoOnDark} src={dark} alt="" draggable={false} onLoad={watch} />}
            {light && <img className={styles.logoOnLight} src={light} alt="" draggable={false} onLoad={watch} />}
          </>
        )}
      </span>
    </>
  );
};

export default BankName;
