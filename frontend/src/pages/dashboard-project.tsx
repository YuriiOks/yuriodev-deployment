import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDashboardLang } from '../context/useDashboardLang';
import InlineError from '../components/dashboards/InlineError/InlineError';
import LoadingBlock from '../components/dashboards/LoadingBlock/LoadingBlock';
import IconPicker from '../components/dashboards/IconPicker/IconPicker';
import ProjectHero from '../components/dashboards/ProjectHero/ProjectHero';
import ProjectTile from '../components/dashboards/ProjectTile/ProjectTile';
import QuickAdd from '../components/dashboards/QuickAdd/QuickAdd';
import TaskPanel from '../components/dashboards/TaskPanel/TaskPanel';
import { pagePath } from '../data/site';
import { useDashboardMode } from '../hooks/useDashboardMode';
import { useLiveTasks } from '../hooks/useLiveTasks';
import { useNow } from '../hooks/useNow';
import { usePageTitle } from '../hooks/usePageTitle';
import { useProjects } from '../hooks/useProjects';
import { dateLabel, fill } from '../services/dashboards/calendarLabels';
import type { LiveProject, LiveTask } from '../services/dashboards/liveApi';
import { localDate } from '../services/dashboards/liveTime';
import { groupTasks } from '../services/dashboards/taskGroups';
import styles from './dashboard-project.module.css';
import space from './dashboard-space.module.css';
import live from './dashboard-space-live.module.css';

/** The state of a project page that has nothing to show: a title, a line, and the way back to the hub. */
const Missing = ({ title, text }: { title: string; text: string }) => {
  const { t } = useDashboardLang();
  usePageTitle(title);
  return (
    <section className={styles.missing} role="region" aria-label={title}>
      <h1>{title}</h1>
      <p>{text}</p>
      <Link to={pagePath('dashboards')} className={styles.back}>
        {t.backToHub}
      </Link>
    </section>
  );
};

/** While the project is not known yet the page has the hub's title (a child sets it: a parent's effect would override the board's). */
const Waiting = ({ children }: { children: ReactNode }) => {
  const { t } = useDashboardLang();
  usePageTitle(t.titles.hub);
  return <>{children}</>;
};

interface BoardProps {
  project: LiveProject;
  rename: (name: string) => Promise<boolean>;
  archive: () => Promise<boolean>;
  setIcon: (icon: string | null) => Promise<boolean>;
}

/** A project's page on real data: its name with Rename and Archive, quick-add, the task groups and Done. */
const ProjectBoard = ({ project, rename, archive, setIcon }: BoardProps) => {
  const { t } = useDashboardLang();
  usePageTitle(project.name);
  const tasks = useLiveTasks({ project: project.id });
  const today = localDate(useNow());
  const groups = groupTasks(tasks.tasks, today, tasks.sticky);
  // The strip's facts: what is open, what is overdue, and the nearest date still ahead.
  const openTasks = tasks.tasks.filter((task) => task.status === 'open');
  const openCount = openTasks.length;
  const overdue = openTasks.filter((task) => task.dueDate !== null && task.dueDate < today).length;
  const nextDue = openTasks.map((task) => task.dueDate).filter((due): due is string => due !== null && due >= today).sort()[0] ?? null;
  const nameRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (renaming) nameRef.current?.focus();
  }, [renaming]);

  const stopRenaming = () => {
    setRenaming(false);
    setName(project.name);
    setError(null);
  };

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (busy || trimmed === '') return;
    if (trimmed === project.name) {
      stopRenaming();
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await rename(trimmed);
    setBusy(false);
    if (ok) setRenaming(false);
    else setError(t.renameFailed);
  };

  const chooseIcon = async (icon: string | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await setIcon(icon);
    setBusy(false);
    if (ok) setPicking(false);
    else setError(t.iconFailed);
  };

  const archiveClick = async () => {
    if (busy) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await archive();
    setBusy(false);
    if (!ok) {
      setConfirming(false);
      setError(t.archiveFailed);
    }
  };

  const panel = (id: string, title: string, list: readonly LiveTask[], empty?: string) => (
    <TaskPanel
      key={id}
      id={id}
      title={title}
      tasks={list}
      today={today}
      areas={null}
      failed={tasks.failed}
      empty={empty}
      onToggle={tasks.toggle}
      onSave={tasks.update}
      onDelete={tasks.remove}
    />
  );

  let body: ReactNode;
  let split = false;
  let rows = 1;
  if (tasks.status === 'loading') {
    body = <LoadingBlock rows={4} />;
  } else if (tasks.status === 'error') {
    body = (
      <div className={live.state}>
        <InlineError message={t.loadFailed} onRetry={tasks.reload} />
      </div>
    );
  } else {
    const panels = [
      panel('priority', t.groupPriority, groups.priority, tasks.tasks.length === 0 ? t.emptyTasks : t.emptyPriority),
      ...(groups.due.length ? [panel('due', t.groupDue, groups.due)] : []),
      ...(groups.week.length ? [panel('week', t.groupWeek, groups.week)] : []),
      ...(groups.later.length ? [panel('later', t.groupLater, groups.later)] : []),
      ...(groups.undated.length ? [panel('undated', t.groupNoDate, groups.undated)] : []),
    ];
    split = panels.length > 1;
    rows = Math.max(panels.length - 1, 1);
    body = panels;
  }

  return (
    <>
      <ProjectHero
        tile={<ProjectTile name={project.name} icon={project.icon} />}
        name={project.name}
        facts={
          tasks.status === 'ready' ? (
            <>
              <span className={styles.fact}>{openCount}</span> {t.statOpen} · <span className={overdue > 0 ? styles.alarm : styles.fact}>{overdue}</span> {t.statOverdue}
            </>
          ) : undefined
        }
        aside={nextDue ? fill(t.nextDue, { date: dateLabel(nextDue, t) }) : undefined}
        rename={
          renaming ? (
            <form
              className={styles.rename}
              aria-label={t.renameProject}
              onSubmit={saveName}
              onKeyDown={(event) => {
                if (event.key === 'Escape') stopRenaming();
              }}
            >
              <input
                ref={nameRef}
                className={styles.input}
                aria-label={t.projectName}
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
              <button type="submit" className={styles.save} disabled={busy}>
                {t.save}
              </button>
              <button type="button" className={styles.cancel} onClick={stopRenaming} disabled={busy}>
                {t.cancel}
              </button>
            </form>
          ) : null
        }
        actions={
          !renaming && (
            <>
              <button type="button" className={styles.action} onClick={() => setRenaming(true)}>
                {t.renameProject}
              </button>
              <button type="button" className={styles.action} aria-expanded={picking} onClick={() => setPicking((open) => !open)}>
                {t.iconLabel}
              </button>
              <button
                type="button"
                className={`${styles.action} ${confirming ? styles.confirm : ''}`}
                disabled={busy}
                onClick={archiveClick}
                onBlur={() => setConfirming(false)}
              >
                {confirming ? t.confirmArchive : t.archiveProject}
              </button>
            </>
          )
        }
      />
      {error && (
        <div className={styles.error}>
          <InlineError message={error} />
        </div>
      )}
      {picking && (
        <div className={styles.picker}>
          <IconPicker value={project.icon} onChange={chooseIcon} disabled={busy} />
        </div>
      )}
      <QuickAdd
        placeholder={t.addTask}
        onSubmit={async (title) => ((await tasks.create({ title })) ? t.addTaskFailed : null)}
      />
      <div className={space.panels} data-split={split ? 'flow' : undefined} data-wide-first={split ? 'true' : undefined} style={{ '--rows': rows } as CSSProperties}>
        {body}
      </div>
      {tasks.status === 'ready' && groups.done.length > 0 && (
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
              areas={null}
              failed={tasks.failed}
              onToggle={tasks.toggle}
              onSave={tasks.update}
              onDelete={tasks.remove}
            />
          )}
        </div>
      )}
    </>
  );
};

/** /dashboards/projects/<id> on real data: finds the project in the server's list, then shows its board. */
const LiveProject = ({ id }: { id: string }) => {
  const { t } = useDashboardLang();
  const navigate = useNavigate();
  const projects = useProjects();
  const project = projects.projects.find((candidate) => candidate.id === id);

  if (projects.status === 'loading') return <Waiting><LoadingBlock rows={4} /></Waiting>;
  if (projects.status === 'error') return <Waiting><InlineError message={t.projectsFailed} onRetry={projects.reload} /></Waiting>;
  if (!project || project.archived) return <Missing title={t.projectNotFound} text={t.projectNotFoundText} />;
  return (
    <ProjectBoard
      key={project.id}
      project={project}
      rename={async (name) => (await projects.update(project.id, { name })) === null}
      setIcon={async (icon) => (await projects.update(project.id, { icon })) === null}
      archive={async () => {
        const failure = await projects.update(project.id, { archived: true });
        if (failure === null) navigate(pagePath('dashboards'));
        return failure === null;
      }}
    />
  );
};

/** The project route: a project page needs the live data; on the sample data there are no projects. */
const DashboardProject = () => {
  const { id = '' } = useParams();
  const { t } = useDashboardLang();
  const { mode } = useDashboardMode();
  if (mode !== 'live') return <Missing title={t.projectNotFound} text={t.projectsNeedData} />;
  return <LiveProject key={id} id={id} />;
};

export default DashboardProject;
