import React from 'react';
import { useImageFallback } from '../../../hooks/useImageFallback';
import { prefersWhiteInk } from '../../../services/dashboards/providerBrand';
import styles from './Recurring.module.css';

/**
 * A payment's picture: its `icon_url` in an <img> (at most a few at a time, only when near the screen, no referrer sent; the tile shows if it fails to load), else a tile in its colour
 * with its first letter. Decorative: the name is beside it.
 */
const RecurringIcon: React.FC<{ name: string; iconUrl: string | null; color: string | null; pair?: { readonly background: string; readonly foreground: string } | null }> = ({ name, iconUrl, color, pair = null }) => {
  const image = useImageFallback(iconUrl);
  if (iconUrl && !image.failed) {
    return (
      <span ref={image.ref} aria-hidden="true" className={styles.icon}>
        <img key={image.attempt} src={image.ready ? iconUrl : undefined} alt="" referrerPolicy="no-referrer" decoding="async" draggable={false} onLoad={image.onLoad} onError={image.onError} />
      </span>
    );
  }
  const style = color ? ({ '--tile-bg': color, '--tile-fg': prefersWhiteInk(color) ? '#ffffff' : '#000000' } as React.CSSProperties) : pair ? ({ '--tile-bg': pair.background, '--tile-fg': pair.foreground } as React.CSSProperties) : undefined;
  return (
    <span aria-hidden="true" className={styles.icon} data-colored={color || pair ? 'true' : undefined} style={style}>
      {Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?'}
    </span>
  );
};

export default RecurringIcon;
