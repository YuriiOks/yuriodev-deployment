import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { TAB_TONE } from '../../../services/dashboards/spaces';
import type { Panel as PanelData } from '../../../services/dashboards/types';
import { cx } from '../../../utils/cx';
import AreaTiles from '../AreaTiles/AreaTiles';
import DashIcon from '../DashIcon/DashIcon';
import PanelRow from '../PanelRow/PanelRow';
import styles from './Panel.module.css';

export interface PanelProps {
  panel: PanelData;
  /** Which tasks the visitor has ticked off or un-ticked, by row id, over each task's own state. */
  done: Readonly<Record<string, boolean>>;
  onToggle: (id: string) => void;
}

/** A titled group of rows (or the life-areas tiles). The priority panel spans the full row and tints its rows. */
const Panel: React.FC<PanelProps> = ({ panel, done, onToggle }) => {
  const { text } = useDashboardLang();
  const titleId = `panel-${panel.id}-title`;
  // The priority panel has a flag; other overview panels are titled with no icon (it would be the same grid on each).
  const headingIcon = panel.priority ? 'flag' : panel.tab === 'overview' ? null : panel.tab;

  return (
    <section aria-labelledby={titleId} className={cx(styles.panel, panel.priority && styles.priority)}>
      <div className={styles.head}>
        {headingIcon && <DashIcon name={headingIcon} tone={TAB_TONE[panel.tab]} />}
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
              tab={panel.tab}
              done={done[row.id] ?? (row.kind === 'task' && row.done === true)}
              onToggle={onToggle}
              tinted={panel.priority === true}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

export default Panel;
