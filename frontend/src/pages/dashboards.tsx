import { useDashboardLang } from '../context/useDashboardLang';
import DashboardHeading from '../components/dashboards/DashboardHeading/DashboardHeading';
import InlineError from '../components/dashboards/InlineError/InlineError';
import LoadingBlock from '../components/dashboards/LoadingBlock/LoadingBlock';
import SpaceCard from '../components/dashboards/SpaceCard/SpaceCard';
import { useDashboardMode } from '../hooks/useDashboardMode';
import { useLiveSummary } from '../hooks/useLiveSummary';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSpaces } from '../hooks/useDashboards';
import { nextAtLabel } from '../services/dashboards/liveLabels';
import { SPACES } from '../services/dashboards/spaces';
import { summarize } from '../services/dashboards/summary';
import styles from './dashboards.module.css';

/** Three cards from the bundled sample data. */
const SampleCards = () => {
  const spaces = useSpaces();
  return (
    <div className={styles.cards}>
      {spaces.map((space) => (
        <SpaceCard key={space.id} space={space.id} summary={summarize(space)} next={{ at: space.hero.at, title: space.hero.title }} />
      ))}
    </div>
  );
};

/** Three cards from GET /summary: the counters and the next event of each space. */
const LiveCards = () => {
  const { t } = useDashboardLang();
  const { status, summary, reload } = useLiveSummary();
  const now = new Date();
  if (status === 'error' || (status === 'ready' && !summary)) return <InlineError message={t.summaryFailed} onRetry={reload} />;
  if (status === 'loading' || !summary) {
    return (
      <div className={styles.cards}>
        {SPACES.map((id) => (
          <LoadingBlock key={id} rows={2} />
        ))}
      </div>
    );
  }
  return (
    <div className={styles.cards}>
      {SPACES.map((id) => {
        const { open, priority, overdue, next } = summary[id];
        return (
          <SpaceCard
            key={id}
            space={id}
            summary={{ open, priority, overdue }}
            next={next ? { ...nextAtLabel(next.startsAt, now, t), title: { ru: next.title, en: next.title } } : null}
          />
        );
      })}
    </div>
  );
};

/** /dashboards: the entrance. A title, three cards with counters and what is next; no task is ever shown here. */
const Dashboards = () => {
  const { t } = useDashboardLang();
  usePageTitle(t.titles.hub);
  const { mode } = useDashboardMode();

  return (
    <>
      <DashboardHeading id="dashboards-title" title={t.hubTitle} />
      {mode === 'live' ? <LiveCards /> : <SampleCards />}
    </>
  );
};

export default Dashboards;
