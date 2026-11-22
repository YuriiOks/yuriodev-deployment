import { useDashboardLang } from '../context/useDashboardLang';
import DashboardHeading from '../components/dashboards/DashboardHeading/DashboardHeading';
import SpaceCard from '../components/dashboards/SpaceCard/SpaceCard';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSpaces } from '../hooks/useDashboards';
import { pageLabel } from '../data/site';
import { summarize } from '../services/dashboards/summary';
import styles from './dashboards.module.css';

/** /dashboards: the entrance. Three cards with counters and what is next; no task is ever shown here. */
const Dashboards = () => {
  usePageTitle(pageLabel('dashboards'));
  const { t } = useDashboardLang();
  const spaces = useSpaces();

  return (
    <>
      <DashboardHeading id="dashboards-title" title={t.hubTitle} lead={t.hubLead} />
      <div className={styles.cards}>
        {spaces.map((space) => (
          <SpaceCard key={space.id} space={space} summary={summarize(space)} />
        ))}
      </div>
    </>
  );
};

export default Dashboards;
