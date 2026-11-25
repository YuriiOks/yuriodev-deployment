import React, { useState } from 'react';
import type { ProviderLogo } from '../../../services/dashboards/financeApi';
import { useImageFallback } from '../../../hooks/useImageFallback';
import { brandFor, wordmarkIsWhite } from '../../../services/dashboards/providerBrand';
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
  // Pictures that cannot be loaded (the server was restarting) give way to the text name at once and are asked for once more a few seconds later.
  const image = useImageFallback(`${logo?.onDark ?? ''}|${logo?.onLight ?? ''}|${logo?.mark ?? ''}`);
  if (!logo || (!logo.onDark && !logo.onLight) || image.failed) return <>{name}</>;
  // A chip sits on the theme's own surface, not on a brand colour, so it follows the theme like a neutral card.
  const brand = size === 'chip' ? null : brandFor(provider, logo);
  const watch = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) setSquare(naturalWidth / naturalHeight < 1.6);
  };
  // The variant must contrast with the surface it sits on; a wrong-contrast image would be invisible, so when the right one is missing
  // the text name shows instead (on a brand card, in its ink; on a theme surface, in the themes that lack the variant).
  const dark = logo.onDark;
  const light = logo.onLight;
  // A near-square wordmark (artwork with small text) is unreadable at a wordmark's height: the bank's own square mark takes its place on a card.
  if (square && logo.mark && size === 'card') {
    return (
      <>
        <span className="sr-only">{name}</span>
        <span ref={image.ref} aria-hidden="true" className={styles.logoMark}>
          {image.ready && <img key={image.attempt} onError={image.onError} src={logo.mark} alt="" decoding="async" draggable={false} onLoad={image.onLoad} />}
        </span>
      </>
    );
  }
  if (brand) {
    const single = wordmarkIsWhite(brand) ? dark : light;
    if (!single) return <>{name}</>;
    return (
      <>
        <span className="sr-only">{name}</span>
        <span ref={image.ref} aria-hidden="true" className={styles.logos} data-surface="brand" data-shape={square ? 'square' : 'wide'} data-size={size}>
          {image.ready && <img key={image.attempt} onError={image.onError} className={styles.logoOnDark} src={single} alt="" decoding="async" draggable={false} onLoad={(event) => { image.onLoad(); watch(event); }} />}
        </span>
      </>
    );
  }
  if (!dark && !light) return <>{name}</>;
  return (
    <>
      <span className="sr-only">{name}</span>
      <span ref={image.ref} aria-hidden="true" className={styles.logos} data-surface="theme" data-missing={!light ? 'light' : !dark ? 'dark' : undefined} data-shape={square ? 'square' : 'wide'} data-size={size}>
        {dark && image.ready && <img key={`dark-${image.attempt}`} onError={image.onError} className={styles.logoOnDark} src={dark} alt="" decoding="async" draggable={false} onLoad={(event) => { image.onLoad(); watch(event); }} />}
        {light && image.ready && <img key={`light-${image.attempt}`} onError={image.onError} className={styles.logoOnLight} src={light} alt="" decoding="async" draggable={false} onLoad={(event) => { image.onLoad(); watch(event); }} />}
        {(!dark || !light) && <span className={styles.logoText}>{name}</span>}
      </span>
    </>
  );
};

export default BankName;
