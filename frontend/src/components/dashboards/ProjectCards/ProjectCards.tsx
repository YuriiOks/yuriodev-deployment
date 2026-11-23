import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { projectPath } from '../../../data/site';
import { useProjects } from '../../../hooks/useProjects';
import { ApiError } from '../../../services/dashboards/liveApi';
import { cx } from '../../../utils/cx';
import InlineError from '../InlineError/InlineError';
import LoadingBlock from '../LoadingBlock/LoadingBlock';
import { projectScheme } from '../../../services/dashboards/projectSchemes';
import ProjectTile from '../ProjectTile/ProjectTile';
import styles from './ProjectCards.module.css';

/** The "new project" tile: a button that opens a one-field form in place, and creates the project on Enter or Create. */
const NewProject: React.FC<{ onCreate: (name: string) => Promise<string | null> }> = ({ onCreate }) => {
  const { t } = useDashboardLang();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setName('');
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (busy || trimmed === '') return;
    setBusy(true);
    setError(null);
    const failure = await onCreate(trimmed);
    setBusy(false);
    if (failure === null) close();
    else {
      setError(failure);
      inputRef.current?.focus();
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className={styles.newTile}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true" className={styles.plus}>
          +
        </span>
        {t.newProject}
      </button>
    );
  }

  return (
    <form
      className={cx(styles.card, styles.newForm)}
      aria-label={t.newProject}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
    >
      <label htmlFor={`${id}-name`} className={styles.label}>
        {t.projectName}
      </label>
      <input
        id={`${id}-name`}
        ref={inputRef}
        className={styles.input}
        value={name}
        maxLength={80}
        placeholder={t.projectNamePlaceholder}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          setName(event.target.value);
          if (error) setError(null);
        }}
      />
      {error && <InlineError message={error} />}
      <div className={styles.actions}>
        <button type="submit" className={styles.create} disabled={busy}>
          {t.createProject}
        </button>
        <button type="button" className={styles.cancel} onClick={close} disabled={busy}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
};

/**
 * The hub's Projects section (real data only): one card per project that is not archived (its name and three
 * plain counters, the whole card a link to its page), then the "new project" tile. It has its own loading and
 * error state with a retry, so a failure here leaves the three spaces above it alone.
 */
const ProjectCards: React.FC = () => {
  const { t } = useDashboardLang();
  const { status, projects, reload, create } = useProjects();
  const visible = projects.filter((project) => !project.archived);

  const createNamed = async (name: string): Promise<string | null> => {
    const result = await create(name);
    if (!(result instanceof ApiError)) return null;
    return result.status === 409 ? t.projectExists : t.projectCreateFailed;
  };

  return (
    <section aria-labelledby="dashboards-projects-title" className={styles.section}>
      <h2 id="dashboards-projects-title" className={styles.title}>
        {t.projectsTitle}
      </h2>
      {status === 'error' && <InlineError message={t.projectsFailed} onRetry={reload} />}
      {status === 'loading' && (
        <div className={styles.cards}>
          <LoadingBlock rows={2} />
        </div>
      )}
      {status === 'ready' && (
        <div className={styles.cards}>
          {visible.map((project) => {
            const stats: ReadonlyArray<readonly [number, string, boolean]> = [
              [project.open, t.statOpen, false],
              [project.priority, t.statPriority, false],
              [project.overdue, t.statOverdue, project.overdue > 0],
            ];
            const titleId = `project-${project.id}-title`;
            return (
              <section key={project.id} aria-labelledby={titleId} className={styles.card} data-scheme={projectScheme(project.id)}>
                <div className={styles.head}>
                  <ProjectTile name={project.name} />
                  <h3 id={titleId} className={styles.name}>
                    <Link to={projectPath(project.id)} className={styles.link}>
                      {project.name}
                    </Link>
                  </h3>
                </div>
                <ul className={styles.stats}>
                  {stats.map(([value, label, alarm]) => (
                    <li key={label} className={styles.stat}>
                      <span className={cx(styles.number, value === 0 && styles.zero, alarm && styles.alarm)}>{value}</span>
                      <span className={styles.statLabel}>{label}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <NewProject onCreate={createNamed} />
        </div>
      )}
    </section>
  );
};

export default ProjectCards;
