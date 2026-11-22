import { useState } from 'react';
import { useDashboardLang } from '../context/useDashboardLang';
import Panel from '../components/dashboards/Panel/Panel';
import QuickAdd from '../components/dashboards/QuickAdd/QuickAdd';
import SourceTabs from '../components/dashboards/SourceTabs/SourceTabs';
import SpaceHero from '../components/dashboards/SpaceHero/SpaceHero';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSpace } from '../hooks/useDashboards';
import { pageLabel } from '../data/site';
import { SPACE_PAGE } from '../services/dashboards/spaces';
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
  usePageTitle(pageLabel(SPACE_PAGE[id]));
  const { text } = useDashboardLang();
  const space = useSpace(id);
  const [selected, setSelected] = useState<TabId>('overview');
  const [done, setDone] = useState<Readonly<Record<string, boolean>>>({});

  const current = space.tabs.includes(selected) ? selected : 'overview';
  const counts: Partial<Record<TabId, number>> = {};
  for (const tab of space.tabs) counts[tab] = tabCount(space, tab);
  const panels = space.panels.filter((panel) => panel.tab === current);

  const toggle = (rowId: string) => {
    const row = space.panels.flatMap((panel) => panel.rows).find((r) => r.id === rowId);
    const was = done[rowId] ?? (row?.kind === 'task' && row.done === true);
    setDone({ ...done, [rowId]: !was });
  };

  return (
    <>
      <SpaceHero space={space} />
      <QuickAdd placeholder={text(space.quickAddPlaceholder)} />
      <SourceTabs tabs={space.tabs} current={current} counts={counts} onSelect={setSelected} />
      <div className={styles.panels}>
        {panels.map((panel) => (
          <Panel key={panel.id} panel={panel} done={done} onToggle={toggle} />
        ))}
      </div>
    </>
  );
};

export default DashboardSpace;
