import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { useSpaceNames } from '../../../hooks/useSpaceNames';
import { SPACE_MONOGRAM } from '../../../services/dashboards/spaces';
import type { SpaceId } from '../../../services/dashboards/types';
import styles from './SpaceTile.module.css';

export interface SpaceTileProps {
  space: SpaceId;
}

/**
 * The space's mark: a 24px square. On the live dashboards it holds an image when there is one (the server's icon,
 * or the site's mark for the personal space), otherwise the space's fill with its monogram. The name always sits
 * beside it, so the image carries no text of its own.
 */
const SpaceTile: React.FC<SpaceTileProps> = ({ space }) => {
  const { text } = useDashboardLang();
  const { iconOf } = useSpaceNames();
  const icon = iconOf(space);
  return (
    <span aria-hidden="true" className={styles.tile} data-space={space} data-icon={icon ? 'true' : undefined}>
      {icon ? <img className={styles.icon} src={icon} alt="" draggable={false} /> : text(SPACE_MONOGRAM[space])}
    </span>
  );
};

export default SpaceTile;
