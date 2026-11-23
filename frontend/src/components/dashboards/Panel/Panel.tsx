import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import type { Panel as PanelData } from '../../../services/dashboards/types';
import AreaTiles from '../AreaTiles/AreaTiles';
import PanelRow from '../PanelRow/PanelRow';
import styles from './Panel.module.css';

export interface PanelProps {
  panel: PanelData;
  /** Which tasks the visitor has ticked off or un-ticked, by row id, over each task's own state. */
  done: Readonly<Record<string, boolean>>;
  onToggle: (id: string) => void;
}

/** A titled group of rows (or the life-areas list): the title, a plain count, then the rows. No icon, no capsule. */
const Panel: React.FC<PanelProps> = ({ panel, done, onToggle }) => {
  const { text } = useDashboardLang();
  const titleId = `panel-${panel.id}-title`;
  // One lead column per panel (checkbox or CI icon), reserved for every row if any row has one, so titles line up.
  const lead = panel.rows.some((row) => row.kind !== 'info');

  return (
    <section aria-labelledby={titleId} className={styles.panel} data-emphasis={panel.priority ? 'true' : undefined}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {text(panel.title)}
        </h2>
        {panel.rows.length > 0 && <span className={styles.count}>{panel.rows.length}</span>}
        {panel.note && <span className={styles.note}>{text(panel.note)}</span>}
      </div>
      {panel.tiles && <AreaTiles tiles={panel.tiles} />}
      {panel.rows.length === 0 && panel.empty && !panel.tiles && <p className={styles.empty}>{text(panel.empty)}</p>}
      {panel.rows.length > 0 && (
        <ul className={styles.rows}>
          {panel.rows.map((row) => (
            <PanelRow
              key={row.id}
              row={row}
              lead={lead}
              done={done[row.id] ?? (row.kind === 'task' && row.done === true)}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

export default Panel;
