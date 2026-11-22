import { useState, type CSSProperties } from 'react';
import { useDashboardLang } from '../context/useDashboardLang';
import Panel from '../components/dashboards/Panel/Panel';
import QuickAdd from '../components/dashboards/QuickAdd/QuickAdd';
import SourceTabs from '../components/dashboards/SourceTabs/SourceTabs';
import SpaceHero from '../components/dashboards/SpaceHero/SpaceHero';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSpace } from '../hooks/useDashboards';
import { tabCount } from '../services/dashboards/summary';
import type { SpaceId, TabId } from '../services/dashboards/types';
import styles from './dashboard-space.module.css';

interface DashboardSpaceProps {
  space: SpaceId;
}

/**
 * /dashboards/personal, /work-1 and /work-2: one space, never mixed with the
 * others. The hero, the quick-add field, the source tabs and the selected
 * tab's panels. Ticking a task is kept here, in memory, for now.
 */
const DashboardSpace = ({ space: id }: DashboardSpaceProps) => {
  const { t, text } = useDashboardLang();
  usePageTitle(t.titles[id]);
  const space = useSpace(id);
  const [selected, setSelected] = useState<TabId>('overview');
  const [done, setDone] = useState<Readonly<Record<string, boolean>>>({});

  const current = space.tabs.includes(selected) ? selected : 'overview';
  const counts: Partial<Record<TabId, number>> = {};
  for (const tab of space.tabs) counts[tab] = tabCount(space, tab);
  const panels = space.panels.filter((panel) => panel.tab === current);

  // The grid's columns follow the panels: a tab with one panel fills the row, two share it, three sit in
  // three columns, four in two by two; the priority panel always spans the full row on its own.
  const others = panels.filter((panel) => !panel.priority).length;
  // Panels with references or long titles get two to a row; the others up to three.
  const roomy = panels.some((panel) => !panel.priority && panel.roomy);
  const wide = roomy ? Math.min(Math.max(others, 1), 2) : others === 4 ? 2 : Math.min(Math.max(others, 1), 3);
  // With two columns and an odd number of panels, the last one takes the whole row.
  const lastOther = panels.filter((panel) => !panel.priority).at(-1);
  const fillLast = wide === 2 && others > 1 && others % 2 === 1;
  const gridStyle = { '--cols-md': Math.min(Math.max(others, 1), 2), '--cols-lg': wide } as CSSProperties;

  const toggle = (rowId: string) => {
    const row = space.panels.flatMap((panel) => panel.rows).find((r) => r.id === rowId);
    const was = done[rowId] ?? (row?.kind === 'task' && row.done === true);
    setDone({ ...done, [rowId]: !was });
  };

  return (
    <>
      <SpaceHero space={space} />
      <QuickAdd placeholder={text(space.quickAddPlaceholder)} />
      <SourceTabs tabs={space.tabs} current={current} counts={counts} onSelect={setSelected} idPrefix={id} />
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${current}`}
        className={styles.panels}
        style={gridStyle}
      >
        {panels.map((panel) => (
          <Panel key={panel.id} panel={panel} done={done} onToggle={toggle} fill={fillLast && panel === lastOther} />
        ))}
      </div>
    </>
  );
};

export default DashboardSpace;
