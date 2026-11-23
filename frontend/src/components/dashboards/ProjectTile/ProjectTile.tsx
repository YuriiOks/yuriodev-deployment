import React from 'react';
import { isProjectIconKey } from '../../../services/dashboards/projectIcons';
import ProjectIcon from '../ProjectIcon/ProjectIcon';
import styles from './ProjectTile.module.css';

export interface ProjectTileProps {
  name: string;
  /** The project's icon key; none, or one we have no drawing for, shows the name's first letter. */
  icon?: string | null;
}

/** A project's mark: the same square as a space's, in Anthropic's clay with the warm black on it, holding the chosen drawing or the name's first letter. */
const ProjectTile: React.FC<ProjectTileProps> = ({ name, icon }) => (
  <span aria-hidden="true" className={styles.tile} data-glyph={isProjectIconKey(icon) ? icon : undefined}>
    {isProjectIconKey(icon) ? <ProjectIcon name={icon} size={20} /> : (Array.from(name.trim())[0] ?? '?').toLocaleUpperCase()}
  </span>
);

export default ProjectTile;
