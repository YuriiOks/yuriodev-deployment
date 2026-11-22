import { useDashboardLang } from '../context/useDashboardLang';
import DashboardHeading from '../components/dashboards/DashboardHeading/DashboardHeading';
import SpaceCard from '../components/dashboards/SpaceCard/SpaceCard';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSpaces } from '../hooks/useDashboards';
import { summarize } from '../services/dashboards/summary';
import styles from './dashboards.module.css';

/** /dashboards: the entrance. A title, three cards with counters and what is next; no task is ever shown here. */
const Dashboards = () => {
  const { t } = useDashboardLang();
  usePageTitle(t.titles.hub);
  const spaces = useSpaces();

  return (
    <>
      <DashboardHeading id="dashboards-title" title={t.hubTitle} />
      <div className={styles.cards}>
        {spaces.map((space) => (
          <SpaceCard key={space.id} space={space} summary={summarize(space)} />
        ))}
      </div>
    </>
  );
};

export default Dashboards;
