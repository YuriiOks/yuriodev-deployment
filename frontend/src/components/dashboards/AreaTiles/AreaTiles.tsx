import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import type { Tile } from '../../../services/dashboards/types';
import styles from './AreaTiles.module.css';

export interface AreaTilesProps {
  tiles: readonly Tile[];
}

/** The life-areas panel's body: each area and its open-task count, as plain rows (a zero is quiet). */
const AreaTiles: React.FC<AreaTilesProps> = ({ tiles }) => {
  const { text } = useDashboardLang();
  return (
    <ul className={styles.tiles}>
      {tiles.map((tile) => (
        <li key={tile.id} className={styles.tile}>
          <span>{text(tile.name)}</span>
          <span className={styles.count} data-zero={tile.count === 0 ? 'true' : undefined}>
            {tile.count}
          </span>
        </li>
      ))}
    </ul>
  );
};

export default AreaTiles;
