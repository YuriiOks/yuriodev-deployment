import React from 'react';
import styles from './ProjectTile.module.css';

export interface ProjectTileProps {
  name: string;
}

/** A project's mark: the same 24px square as a space's, in the neutral ink (no fourth brand palette), with the name's first letter. */
const ProjectTile: React.FC<ProjectTileProps> = ({ name }) => (
  <span aria-hidden="true" className={styles.tile}>
    {(Array.from(name.trim())[0] ?? '?').toLocaleUpperCase()}
  </span>
);

export default ProjectTile;
