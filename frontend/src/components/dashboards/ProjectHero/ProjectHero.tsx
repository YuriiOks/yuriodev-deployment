import React from 'react';
import styles from './ProjectHero.module.css';

export interface ProjectHeroProps {
  /** The project's tile (its icon or letter in the clay). */
  tile: React.ReactNode;
  /** The project's name: the page's h1 (a quiet label, like a space's name in its strip). */
  name: string;
  /** The line that matters: the counts (open, overdue), as the space strip's next event is. */
  facts?: React.ReactNode;
  /** The shorter fact at its right (the next due date). */
  aside?: React.ReactNode;
  /** Rename, Icon and Archive: tucked into the strip's end. */
  actions: React.ReactNode;
  /** While renaming, this form takes the place of the name, the facts and the aside. */
  rename?: React.ReactNode;
}

/**
 * A project page's strip: the same glass strip as a space's (SpaceHero.module.css), in the project's scheme (the page wears
 * it): the tile, the name, a useful right-hand fact, and the project's actions at the end.
 */
const ProjectHero: React.FC<ProjectHeroProps> = ({ tile, name, facts, aside, actions, rename }) => (
  <section aria-label={name} className={styles.strip}>
    <span className={styles.tile}>{tile}</span>
    {rename ? (
      <div className={styles.rename}>{rename}</div>
    ) : (
      <>
        <h1 className={styles.name}>{name}</h1>
        {facts && <p className={styles.facts}>{facts}</p>}
        {aside && <p className={styles.aside}>{aside}</p>}
      </>
    )}
    <div className={styles.actions}>{actions}</div>
  </section>
);

export default ProjectHero;
