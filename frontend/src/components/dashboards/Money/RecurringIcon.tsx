import React, { useState } from 'react';
import { useImageFallback } from '../../../hooks/useImageFallback';
import { prefersWhiteInk } from '../../../services/dashboards/providerBrand';
import styles from './Recurring.module.css';

type IconProps = { name: string; iconUrl: string | null; color: string | null; pair?: { readonly background: string; readonly foreground: string } | null };

const Icon: React.FC<IconProps> = ({ name, iconUrl, color, pair = null }) => {
  const image = useImageFallback(iconUrl);
  const [loaded, setLoaded] = useState(false);
  const style = color ? ({ '--tile-bg': color, '--tile-fg': prefersWhiteInk(color) ? '#ffffff' : '#000000' } as React.CSSProperties) : pair ? ({ '--tile-bg': pair.background, '--tile-fg': pair.foreground } as React.CSSProperties) : undefined;
  const picture = iconUrl !== null && !image.failed;
  // The tile (its colour and first letter) is always under the picture; the picture fades in over it once it has loaded, and a picture that cannot be loaded
  // leaves the tile as it was. The component is keyed by the address, so a new address starts afresh.
  return (
    <span ref={image.ref} aria-hidden="true" className={styles.icon} data-colored={color || pair ? 'true' : undefined} data-picture={picture && loaded ? 'true' : undefined} style={style}>
      {Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?'}
      {picture && image.ready && iconUrl && (
        <img
          key={image.attempt}
          className={styles.iconImage}
          src={iconUrl}
          alt=""
          referrerPolicy="no-referrer"
          decoding="async"
          draggable={false}
          onLoad={() => {
            image.onLoad();
            setLoaded(true);
          }}
          onError={image.onError}
        />
      )}
    </span>
  );
};

/**
 * A payment's picture: its `icon_url` in an <img> (at most a few at a time, only when near the screen, no referrer sent), fading in over a tile in its
 * colour with its first letter, which stays if the picture fails to load. Decorative: the name is beside it.
 */
const RecurringIcon: React.FC<IconProps> = (props) => <Icon key={props.iconUrl ?? ''} {...props} />;

export default RecurringIcon;
