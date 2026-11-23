import { useDashboardLang } from '../context/useDashboardLang';
import HubHeader from '../components/dashboards/HubHeader/HubHeader';
import InlineError from '../components/dashboards/InlineError/InlineError';
import LoadingBlock from '../components/dashboards/LoadingBlock/LoadingBlock';
import ProjectCards from '../components/dashboards/ProjectCards/ProjectCards';
import SpaceCard from '../components/dashboards/SpaceCard/SpaceCard';
import { useDashboardMode } from '../hooks/useDashboardMode';
import { useLiveSummary } from '../hooks/useLiveSummary';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSpaces } from '../hooks/useDashboards';
import { nearestNext, nextAtLabel } from '../services/dashboards/liveLabels';
import { SPACES } from '../services/dashboards/spaces';
import { summarize } from '../services/dashboards/summary';
import styles from './dashboards.module.css';

/** The entrance on the bundled sample data: the header, then three cards. */
const SampleHub = ({ title }: { title: string }) => {
  const spaces = useSpaces();
  const now = new Date();
  const totalOpen = spaces.reduce((sum, space) => sum + summarize(space).open, 0);
  const soonest = spaces.reduce((best, space) => (space.hero.minutesLeft < best.hero.minutesLeft ? space : best), spaces[0]);
  return (
    <>
      <HubHeader title={title} totalOpen={totalOpen} next={{ at: soonest.hero.at, title: soonest.hero.title }} now={now} />
      <div className={styles.cards}>
        {spaces.map((space) => (
          <SpaceCard key={space.id} space={space.id} summary={summarize(space)} next={{ at: space.hero.at, title: space.hero.title }} />
        ))}
      </div>
    </>
  );
};

/** The entrance on real data: the header and three cards from GET /summary, then the Projects section. */
const LiveHub = ({ title }: { title: string }) => {
  const { t } = useDashboardLang();
  const { status, summary, reload } = useLiveSummary();
  const now = new Date();
  const ready = status === 'ready' && summary !== null;
  const soonest = ready ? nearestNext(SPACES.map((id) => summary[id].next)) : null;
  return (
    <>
      <HubHeader
        title={title}
        totalOpen={ready ? SPACES.reduce((sum, id) => sum + summary[id].open, 0) : null}
        next={soonest ? { ...nextAtLabel(soonest.startsAt, now, t), title: { ru: soonest.title, en: soonest.title } } : null}
        now={now}
      />
      {status === 'error' && <InlineError message={t.summaryFailed} onRetry={reload} />}
      {status === 'loading' && (
        <div className={styles.cards}>
          {SPACES.map((id) => (
            <LoadingBlock key={id} rows={2} />
          ))}
        </div>
      )}
      {ready && (
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
      )}
      <ProjectCards />
    </>
  );
};

/** /dashboards: the entrance. A header card, three coloured cards with counters and what is next; no task is ever shown here. On real data a Projects section follows. */
const Dashboards = () => {
  const { t } = useDashboardLang();
  usePageTitle(t.titles.hub);
  const { mode } = useDashboardMode();
  return mode === 'live' ? <LiveHub title={t.hubTitle} /> : <SampleHub title={t.hubTitle} />;
};

export default Dashboards;
