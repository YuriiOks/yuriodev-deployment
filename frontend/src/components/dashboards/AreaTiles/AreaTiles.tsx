import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import type { Tile } from '../../../services/dashboards/types';
import styles from './AreaTiles.module.css';

export interface AreaTilesProps {
  tiles: readonly Tile[];
}

/** The life-areas panel's body: each area, its colour dot and its open-task count. */
const AreaTiles: React.FC<AreaTilesProps> = ({ tiles }) => {
  const { text } = useDashboardLang();
  return (
    <ul className={styles.tiles}>
      {tiles.map((tile) => (
        <li key={tile.id} className={styles.tile}>
          <span aria-hidden="true" className={styles.dot} data-tone={tile.tone} />
          <span className={styles.name}>{text(tile.name)}</span>
          <span className={styles.count}>{tile.count}</span>
        </li>
      ))}
    </ul>
  );
};

export default AreaTiles;
