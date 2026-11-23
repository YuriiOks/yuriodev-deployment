import React from 'react';
import { areaIconName } from '../../../services/dashboards/areaIcons';
import ProjectIcon from '../ProjectIcon/ProjectIcon';
import type { DrawnIconName } from '../ProjectIcon/iconPaths';
import styles from './AreaIcon.module.css';

export interface AreaIconProps {
  /** A life area's id; an unknown one shows the dot. Leave out and give `name` for the filter's own marks. */
  id?: string | null;
  /** A drawing by name (the filter's "All areas" stack and "No area" dashed circle). */
  name?: DrawnIconName;
  size?: 14 | 16;
}

/** A life area's mark: decorative (aria-hidden; the area's name is always beside it), in the personal palette. */
const AreaIcon: React.FC<AreaIconProps> = ({ id, name, size = 16 }) => (
  <ProjectIcon name={name ?? areaIconName(id)} size={size} className={styles.icon} />
);

export default AreaIcon;
