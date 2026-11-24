import React, { useState } from 'react';
import { prefersWhiteInk } from '../../../services/dashboards/providerBrand';
import styles from './Recurring.module.css';

/**
 * A payment's picture: its `icon_url` in an <img> (https only, no referrer sent, hidden when it fails to load), else a tile in its colour
 * with its first letter. Decorative: the name is beside it.
 */
const RecurringIcon: React.FC<{ name: string; iconUrl: string | null; color: string | null }> = ({ name, iconUrl, color }) => {
  const [failed, setFailed] = useState(false);
  if (iconUrl && !failed) {
    return (
      <span aria-hidden="true" className={styles.icon}>
        <img src={iconUrl} alt="" referrerPolicy="no-referrer" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      </span>
    );
  }
  const style = color ? ({ '--tile-bg': color, '--tile-fg': prefersWhiteInk(color) ? '#ffffff' : '#000000' } as React.CSSProperties) : undefined;
  return (
    <span aria-hidden="true" className={styles.icon} data-colored={color ? 'true' : undefined} style={style}>
      {Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?'}
    </span>
  );
};

export default RecurringIcon;
