import AreaIcon from '../components/dashboards/AreaIcon/AreaIcon';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDashboardLang } from '../context/useDashboardLang';
import { pagePath } from '../data/site';
import InlineError from '../components/dashboards/InlineError/InlineError';
import LoadingBlock from '../components/dashboards/LoadingBlock/LoadingBlock';
import WorkIncome from '../components/dashboards/Money/WorkIncome';
import NotConnected from '../components/dashboards/NotConnected/NotConnected';
import QuickAdd from '../components/dashboards/QuickAdd/QuickAdd';
import SpaceToday from '../components/dashboards/Today/SpaceToday';
import SourceTabs from '../components/dashboards/SourceTabs/SourceTabs';
import SpaceHero from '../components/dashboards/SpaceHero/SpaceHero';
import TaskPanel from '../components/dashboards/TaskPanel/TaskPanel';
import panelStyles from '../components/dashboards/Panel/Panel.module.css';
import rowStyles from '../components/dashboards/PanelRow/PanelRow.module.css';
import { useUpcomingEvents } from '../hooks/useUpcomingEvents';
import { useLiveSummary } from '../hooks/useLiveSummary';
import { useSpaceNames } from '../hooks/useSpaceNames';
import { useLiveTasks } from '../hooks/useLiveTasks';
import { useToday } from '../hooks/useToday';
import { useNow } from '../hooks/useNow';
import { fill } from '../services/dashboards/calendarLabels';
import type { LiveArea, LiveTask } from '../services/dashboards/liveApi';
import { patchTask } from '../services/dashboards/liveApi';
import { liveHero } from '../services/dashboards/liveLabels';
import { withoutCopies } from '../services/dashboards/liveEvents';
import { localDate, splitIso } from '../services/dashboards/liveTime';
import { getSpace } from '../services/dashboards/source';
import { areaCounts, groupTasks, inArea, type TaskGroups } from '../services/dashboards/taskGroups';
import type { SpaceId, TabId } from '../services/dashboards/types';
import styles from './dashboard-space.module.css';
import live from './dashboard-space-live.module.css';

interface LiveSpaceProps {
  space: SpaceId;
  /** The personal space's life areas; empty for the others. */
  areas: readonly LiveArea[];
}

/** The source tabs that list collected tasks, and the task source each one lists. */
const COLLECTED: Partial<Record<TabId, string>> = { github: 'github', linear: 'linear' };
const COLLECTED_SOURCES = new Set(Object.values(COLLECTED));
/** How many rows a collected list shows on the overview before "show all". */
const OVERVIEW_ROWS = 5;
const LINEAR_STAGES =new Set(['started', 'unstarted', 'triage', 'backlog']);

/** The open groups in reading order, as one list (the area tab shows them without the overview's headings). */
const openTasks = (groups: TaskGroups): LiveTask[] => [...groups.priority, ...groups.due, ...groups.week, ...groups.later, ...groups.undated];

/**
 * A space on real data. The overview is the working surface: Priority, then what is due or overdue, this week,
 * later and undated, and a Done disclosure; the personal space also has the life-areas tab, which filters the
 * same tasks by area. The GitHub and Linear tabs list the tasks their collectors brought; on the overview a
 * collected task shows only when it is marked priority. Every other source tab is "not connected yet". Quick-add creates a task in this space (in
 * the chosen area on the areas tab), the checkbox completes or reopens it at once and rolls back on a refusal,
 * and each row opens its editor. Each request has its own loading and error state, so one failure leaves the
 * rest of the page working.
 */
const LiveSpaceFull = ({ space, areas }: LiveSpaceProps) => {
  const { t, text } = useDashboardLang();
  const tasks = useLiveTasks(space);
  const summary = useLiveSummary();
  const now = useNow();
  const today = localDate(now);
  // The same tabs as the sample space (the personal one has the life areas); only the overview and areas are live.
  // On real data the personal space's Payments tab is the Money page: a link in the tab row where the tab was.
  const base = space === 'personal' ? getSpace(space).tabs.filter((tab) => tab !== 'payments') : getSpace(space).tabs;
  // Today is every space's first tab and its default; the tab is kept in the address (?tab=), so a link can lead to one.
  const tabs: readonly TabId[] = ['today', ...base];
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const selected: TabId = (tabs as readonly string[]).includes(asked ?? '') ? (asked as TabId) : 'today';
  const setSelected = (tab: TabId) => {
    const next = new URLSearchParams(params);
    if (tab === 'today') next.delete('tab');
    else next.set('tab', tab);
    setParams(next, { replace: true });
  };
  const [area, setArea] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [showBacklog, setShowBacklog] = useState(false);
  const [showReviewed, setShowReviewed] = useState(false);

  const current = selected;
  const areaList = space === 'personal' ? areas : null;
  // The events of the next days: today's meetings for the overview of a space that has collected tasks (the work spaces), and
  // the next event of the strip, put through the calendar's rule for copies of work meetings.
  const ahead = useUpcomingEvents(true);
  const todayEvents = ahead;
  const { serverNameOf } = useSpaceNames();
  const meetings = withoutCopies(todayEvents.events, { 'work-1': serverNameOf('work-1'), 'work-2': serverNameOf('work-2') })
    .filter((event) => event.space === space && localDate(new Date(event.startsAt)) === today)
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  const hasCollected = tasks.tasks.some((task) => COLLECTED_SOURCES.has(task.source));
  const collectedSource = COLLECTED[current];
  const fromSource = collectedSource ? tasks.tasks.filter((task) => task.source === collectedSource) : [];
  const own = tasks.tasks.filter((task) => !COLLECTED_SOURCES.has(task.source) || task.priority);
  const shown = collectedSource ? fromSource : current === 'areas' ? inArea(own, area) : own;
  const groups = groupTasks(shown, today, tasks.sticky);
  const tabCounts: Partial<Record<TabId, number>> = {};
  for (const [tab, source] of Object.entries(COLLECTED) as [TabId, string][]) {
    tabCounts[tab] = tasks.tasks.filter((task) => task.source === source && task.status === 'open').length;
  }
  const summaryNext = summary.summary?.[space].next ?? null;
  // Until the list is in the strip stays empty rather than show a copy of a work meeting first.
  const next = ahead.status === 'loading' ? null : ahead.nextFor(space, summaryNext);
  const hero = next ? liveHero(next, now, t) : null;

  const create = async (title: string) => {
    const failure = await tasks.create({ title, areaId: current === 'areas' && area ? area : undefined });
    return failure ? t.addTaskFailed : null;
  };

  const panel = (id: string, title: string, list: readonly LiveTask[], empty?: string) => (
    <TaskPanel
      key={id}
      id={id}
      title={title}
      tasks={list}
      today={today}
      areas={areaList}
      failed={tasks.failed}
      empty={empty}
      onToggle={tasks.toggle}
      onSave={tasks.update}
      onDelete={tasks.remove}
    />
  );

  const sourceTabs = (
    <SourceTabs
      tabs={tabs}
      current={current}
      counts={tabCounts}
      onSelect={setSelected}
      idPrefix={space}
      link={space === 'personal' ? { to: pagePath('dashboards-money'), label: t.money.navLink, after: 'areas' } : undefined}
    />
  );
  let body: ReactNode;
  let split: 'main' | 'even' | 'flow' | false = false;
  let wideFirst = false;
  const rows = 1;
  let backlog: LiveTask[] = [];
  let reviewed: LiveTask[] = [];
  if (current === 'work' && space === 'personal') {
    // The personal "Work and income" tab: this month's income and the latest incoming, from the finance API.
    body = <WorkIncome />;
  } else if (current !== 'overview' && current !== 'areas' && (!collectedSource || (tasks.status === 'ready' && fromSource.length === 0))) {
    body = <NotConnected name={t.tabs[current]} />;
  } else if (tasks.status === 'loading') {
    body = <LoadingBlock rows={4} />;
  } else if (tasks.status === 'error') {
    body = (
      <div className={live.state}>
        <InlineError message={t.loadFailed} onRetry={tasks.reload} />
      </div>
    );
  } else if (collectedSource) {
    // The server orders collected tasks (the priority flag, then the source's own priority, then the newest change): the tabs keep that
    // order and never regroup them by date.
    const open = fromSource.filter((task) => task.status === 'open' || tasks.sticky.has(task.id));
    if (current === 'github') {
      const reviews = open.filter((task) => task.stage === 'review');
      reviewed = open.filter((task) => task.stage === 'reviewed');
      const mine = open.filter((task) => task.stage !== 'review' && task.stage !== 'reviewed');
      split = 'even';
      body = [panel('github-mine', t.githubMine, mine, t.emptySource), panel('github-reviews', t.githubReviews, reviews, t.emptySource)];
    } else if (current === 'linear') {
      // By the issue's state type; the backlog waits behind its disclosure under the lists.
      const of = (stage: string) => open.filter((task) => task.stage === stage);
      const other = open.filter((task) => !LINEAR_STAGES.has(task.stage ?? ''));
      backlog = of('backlog');
      split = 'even';
      body = [
        panel('linear-started', t.linearStarted, of('started'), t.emptySource),
        panel('linear-todo', t.linearTodo, of('unstarted'), t.emptySource),
        ...(of('triage').length ? [panel('linear-triage', t.linearTriage, of('triage'))] : []),
        ...(other.length ? [panel('linear-other', t.linearOther, other)] : []),
      ];
    } else {
      body = panel(current, t.tabs[current], open, t.emptySource);
    }
  } else if (current === 'overview' && hasCollected) {
    // "Waiting for me": the priority first (full width), then today's meetings beside the reviews asked of this user,
    // the issues in progress beside the hand-written tasks. Each collected list names its source and leads to its tab.
    split = 'even';
    wideFirst = true;
    const open = tasks.tasks.filter((task) => task.status === 'open');
    const reviews = open.filter((task) => task.source === 'github' && task.stage === 'review');
    const started = open.filter((task) => task.source === 'linear' && task.stage === 'started');
    const short = (id: string, title: string, list: readonly LiveTask[], tab: TabId) => (
      <TaskPanel
        key={id}
        id={id}
        title={title}
        tasks={list.slice(0, OVERVIEW_ROWS)}
        total={list.length}
        more={list.length > OVERVIEW_ROWS ? { label: fill(t.showAll, { n: list.length }), onClick: () => setSelected(tab) } : undefined}
        today={today}
        areas={areaList}
        failed={tasks.failed}
        empty={t.emptySource}
        onToggle={tasks.toggle}
        onSave={tasks.update}
        onDelete={tasks.remove}
      />
    );
    const rest = [...groups.due, ...groups.week, ...groups.later, ...groups.undated];
    body = [
      panel('priority', t.groupPriority, groups.priority, t.emptyPriority),
      <section key="today" aria-labelledby={`${space}-today-title`} className={panelStyles.panel}>
        <div className={panelStyles.head}>
          <h2 id={`${space}-today-title`} className={panelStyles.title}>
            {t.overviewToday}
          </h2>
          {meetings.length > 0 && <span className={panelStyles.count}>{meetings.length}</span>}
        </div>
        {meetings.length === 0 && <p className={panelStyles.empty}>{todayEvents.status === 'error' ? t.loadFailed : t.emptyToday}</p>}
        {meetings.length > 0 && (
          <ul className={panelStyles.rows}>
            {meetings.map((event) => (
              <li key={event.id} className={rowStyles.row}>
                <span className={rowStyles.title} title={event.title}>
                  {event.title}
                </span>
                <span className={rowStyles.meta}>
                  {splitIso(event.startsAt)?.time}–{splitIso(event.endsAt)?.time}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>,
      short('overview-reviews', t.overviewReviews, reviews, 'github'),
      short('overview-started', t.overviewStarted, started, 'linear'),
      ...(rest.length ? [panel('own', t.overviewOwn, rest)] : []),
    ];
  } else if (current === 'overview') {
    const panels = [
      panel('priority', t.groupPriority, groups.priority, tasks.tasks.length === 0 ? t.emptyTasks : t.emptyPriority),
      ...(groups.due.length ? [panel('due', t.groupDue, groups.due)] : []),
      ...(groups.week.length ? [panel('week', t.groupWeek, groups.week)] : []),
      ...(groups.later.length ? [panel('later', t.groupLater, groups.later)] : []),
      ...(groups.undated.length ? [panel('undated', t.groupNoDate, groups.undated)] : []),
    ];
    // Priority across the full width, then the date groups in two or three columns by width (one on a phone), so a long list fills the page.
    split = panels.length > 1 ? 'flow' : false;
    wideFirst = panels.length > 1;
    body = panels;
  } else {
    const counts = areaCounts(tasks.tasks, areaList ?? []);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    const chosen = area === null ? t.allAreas : area === '' ? t.noArea : text(areaName(areaList ?? [], area));
    split = 'main';
    body = [
      panel('area-tasks', chosen, openTasks(groups), tasks.tasks.length === 0 ? t.emptyTasks : t.emptyPriority),
      <section key="filter" aria-label={t.areaFilter} className={live.filter}>
        <h2 className={live.filterHead}>{t.areaFilter}</h2>
        <ul className={live.areas}>
          {[
            { id: null, label: t.allAreas, count: total, mark: <AreaIcon name="stack" /> },
            ...(areaList ?? []).map((a) => ({ id: a.id, label: text({ ru: a.nameRu, en: a.nameEn }), count: counts.get(a.id) ?? 0, mark: <AreaIcon id={a.id} /> })),
            { id: '', label: t.noArea, count: counts.get('') ?? 0, mark: <AreaIcon name="dashed-circle" /> },
          ].map((entry) => (
            <li key={entry.id ?? 'all'}>
              <button type="button" className={live.area} aria-pressed={area === entry.id} onClick={() => setArea(entry.id)}>
                <span className={live.areaName}>
                  {entry.mark}
                  {entry.label}
                </span>
                <span className={live.areaCount} data-zero={entry.count === 0 ? 'true' : undefined}>
                  {entry.count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>,
    ];
  }

  const workingTab = current === 'overview' || current === 'areas';
  return (
    <>
      <div className={styles.top}>
        <SpaceHero space={space} hero={hero} />
        {sourceTabs}
      </div>
      {workingTab && <QuickAdd placeholder={t.addTask} onSubmit={create} />}
      <div
        role="tabpanel"
        id={`${space}-panel`}
        aria-labelledby={`${space}-tab-${current}`}
        className={styles.panels}
        data-split={split ? (split === 'main' ? 'true' : split) : undefined}
        data-wide-first={wideFirst ? 'true' : undefined}
        style={{ '--rows': rows } as CSSProperties}
      >
        {body}
      </div>
      {backlog.length > 0 && (
        <div className={live.done}>
          <button type="button" className={live.doneToggle} aria-expanded={showBacklog} onClick={() => setShowBacklog((open) => !open)}>
            {fill(t.showBacklog, { n: backlog.length })}
          </button>
          {showBacklog && panel('linear-backlog', t.linearBacklog, backlog)}
        </div>
      )}
      {reviewed.length > 0 && (
        <div className={live.done}>
          <button type="button" className={live.doneToggle} aria-expanded={showReviewed} onClick={() => setShowReviewed((open) => !open)}>
            {fill(t.showReviewed, { n: reviewed.length })}
          </button>
          {showReviewed && panel('github-reviewed', t.githubReviewed, reviewed)}
        </div>
      )}
      {workingTab && tasks.status === 'ready' && groups.done.length > 0 && (
        <div className={live.done}>
          <button type="button" className={live.doneToggle} aria-expanded={showDone} onClick={() => setShowDone((open) => !open)}>
            {fill(t.showDone, { n: groups.done.length })}
          </button>
          {showDone && (
            <TaskPanel
              id="done"
              title={t.groupDone}
              tasks={groups.done}
              today={today}
              areas={areaList}
              failed={tasks.failed}
              onToggle={tasks.toggle}
              onSave={tasks.update}
              onDelete={tasks.remove}
            />
          )}
        </div>
      )}
      {summary.status === 'error' && <InlineError message={t.summaryFailed} onRetry={summary.reload} />}
    </>
  );
};

function areaName(areas: readonly LiveArea[], id: string): { ru: string; en: string } {
  const found = areas.find((candidate) => candidate.id === id);
  return found ? { ru: found.nameRu, en: found.nameEn } : { ru: id, en: id };
}

/** The tabs of a space: Today first, then the sample space's own (the personal one has the life areas, and its Payments tab is the Money page). */
function tabsOf(space: SpaceId): readonly TabId[] {
  const base = space === 'personal' ? getSpace(space).tabs.filter((tab) => tab !== 'payments') : getSpace(space).tabs;
  return ['today', ...base];
}

/**
 * The Today tab of a space: the server's one Today answer and nothing else (the task lists, the summary and the events are loaded only when another tab
 * is opened), so the first view of a space is a handful of requests. A task ticked off here is one PATCH, then the answer is asked again.
 */
const TodayTab = ({ space, areas, onSelect }: LiveSpaceProps & { onSelect: (tab: TabId) => void }) => {
  const { t } = useDashboardLang();
  const today = useToday(space, true);
  const nav = <SourceTabs tabs={tabsOf(space)} current="today" counts={{}} onSelect={onSelect} idPrefix={space} link={space === 'personal' ? { to: pagePath('dashboards-money'), label: t.money.navLink, after: 'areas' } : undefined} />;
  return (
    <div role="tabpanel" id={`${space}-panel`} aria-labelledby={`${space}-tab-today`}>
      <SpaceToday
        space={space}
        data={today.value}
        failed={today.status === 'error' || today.refreshFailed}
        areas={areas}
        nav={nav}
        onMarkDone={(id) => void patchTask(id, { status: 'done' }).then(() => today.reload(), () => undefined)}
        onOpenTab={onSelect}
        onReload={() => void today.reload()}
        doneCount={0}
      />
    </div>
  );
};

/** A space on real data: its Today tab (the default), or the rest of the page for any other tab. The tab is kept in the address (`?tab=`). */
const LiveSpace = ({ space, areas }: LiveSpaceProps) => {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const select = (tab: TabId) => {
    const next = new URLSearchParams(params);
    if (tab === 'today') next.delete('tab');
    else next.set('tab', tab);
    setParams(next, { replace: true });
  };
  const other = (tabsOf(space) as readonly string[]).includes(asked ?? '') && asked !== 'today';
  return other ? <LiveSpaceFull space={space} areas={areas} /> : <TodayTab space={space} areas={areas} onSelect={select} />;
};

export default LiveSpace;
