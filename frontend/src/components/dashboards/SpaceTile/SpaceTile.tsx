import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { SPACE_MONOGRAM } from '../../../services/dashboards/spaces';
import type { SpaceId } from '../../../services/dashboards/types';
import styles from './SpaceTile.module.css';

export interface SpaceTileProps {
  space: SpaceId;
}

/** The space's mark: a 24px square in the space's fill with its monogram (the name always sits beside it). */
const SpaceTile: React.FC<SpaceTileProps> = ({ space }) => {
  const { text } = useDashboardLang();
  return (
    <span aria-hidden="true" className={styles.tile} data-space={space}>
      {text(SPACE_MONOGRAM[space])}
    </span>
  );
};

export default SpaceTile;
