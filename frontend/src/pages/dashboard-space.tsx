import { useState, type CSSProperties } from 'react';
import { useDashboardLang } from '../context/useDashboardLang';
import { useDashboardMode } from '../hooks/useDashboardMode';
import LiveSpace from './dashboard-space-live';
import Panel from '../components/dashboards/Panel/Panel';
import QuickAdd from '../components/dashboards/QuickAdd/QuickAdd';
import SourceTabs from '../components/dashboards/SourceTabs/SourceTabs';
import SpaceHero from '../components/dashboards/SpaceHero/SpaceHero';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSpaceNames } from '../hooks/useSpaceNames';
import { useSpace } from '../hooks/useDashboards';
import { tabCount } from '../services/dashboards/summary';
import type { SpaceId, TabId } from '../services/dashboards/types';
import styles from './dashboard-space.module.css';

interface DashboardSpaceProps {
  space: SpaceId;
}

/**
 * /dashboards/personal, /work-1 and /work-2: one space, never mixed with the
 * others. The next-event strip, the source tabs, the quick-add field and the
 * selected tab's panels (the first is the main list, the rest sit beside it),
 * then the sources' freshness. Ticking a task is kept here, in memory, for now.
 */
const SampleSpace = ({ space: id }: DashboardSpaceProps) => {
  const { t, text } = useDashboardLang();
  const space = useSpace(id);
  const [selected, setSelected] = useState<TabId>('overview');
  const [done, setDone] = useState<Readonly<Record<string, boolean>>>({});

  const current = space.tabs.includes(selected) ? selected : 'overview';
  const counts: Partial<Record<TabId, number>> = {};
  for (const tab of space.tabs) counts[tab] = tabCount(space, tab);
  const panels = space.panels.filter((panel) => panel.tab === current);
  const gridStyle = { '--rows': Math.max(panels.length - 1, 1) } as CSSProperties;

  const toggle = (rowId: string) => {
    const row = space.panels.flatMap((panel) => panel.rows).find((r) => r.id === rowId);
    const was = done[rowId] ?? (row?.kind === 'task' && row.done === true);
    setDone({ ...done, [rowId]: !was });
  };

  return (
    <>
      <div className={styles.top}>
        <SpaceHero space={space.id} hero={space.hero} />
        <SourceTabs tabs={space.tabs} current={current} counts={counts} onSelect={setSelected} idPrefix={id} />
      </div>
      <QuickAdd placeholder={text(space.quickAddPlaceholder)} />
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${current}`}
        className={styles.panels}
        data-split={panels.length > 1 ? 'true' : undefined}
        style={gridStyle}
      >
        {panels.map((panel) => (
          <Panel key={panel.id} panel={panel} done={done} onToggle={toggle} />
        ))}
      </div>
      <p className={styles.sync}>
        {t.syncedLabel} {text(space.hero.sync)}
      </p>
    </>
  );
};

/** A space page: on the API's data when the bootstrap says so, otherwise on the bundled sample data. */
const DashboardSpace = ({ space: id }: DashboardSpaceProps) => {
  const { t } = useDashboardLang();
  const { serverNameOf } = useSpaceNames();
  usePageTitle(serverNameOf(id) ?? t.titles[id]);
  const { mode, areas } = useDashboardMode();
  return mode === 'live' ? <LiveSpace key={id} space={id} areas={areas} /> : <SampleSpace key={id} space={id} />;
};

export default DashboardSpace;
