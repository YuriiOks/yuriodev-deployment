import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { projectPath } from '../../../data/site';
import { useProjects } from '../../../hooks/useProjects';
import { ApiError } from '../../../services/dashboards/liveApi';
import { cx } from '../../../utils/cx';
import SectionStrip from '../SectionStrip/SectionStrip';
import InlineError from '../InlineError/InlineError';
import LoadingBlock from '../LoadingBlock/LoadingBlock';
import IconPicker from '../IconPicker/IconPicker';
import ProjectTile from '../ProjectTile/ProjectTile';
import styles from './ProjectCards.module.css';

/** The "new project" form: a card in the grid with a name, an icon and Create; the strip's button opens it. */
const NewProjectForm: React.FC<{ onCreate: (name: string, icon: string | null) => Promise<string | null>; onClose: () => void }> = ({ onCreate, onClose }) => {
  const { t } = useDashboardLang();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const close = onClose;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (busy || trimmed === '') return;
    setBusy(true);
    setError(null);
    const failure = await onCreate(trimmed, icon);
    setBusy(false);
    if (failure === null) close();
    else {
      setError(failure);
      inputRef.current?.focus();
    }
  };

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
      <IconPicker value={icon} onChange={setIcon} disabled={busy} />
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
 * plain counters, the whole card a link to its page) under a section strip that carries the count and the "New project"
 * button (its form opens as one more cell of the same grid). It has its own loading and
 * error state with a retry, so a failure here leaves the three spaces above it alone.
 */
const ProjectCards: React.FC = () => {
  const { t } = useDashboardLang();
  const { status, active: visible, reload, create } = useProjects({ fresh: true });
  const [creating, setCreating] = useState(false);

  const createNamed = async (name: string, icon: string | null): Promise<string | null> => {
    const result = await create(name, icon);
    if (!(result instanceof ApiError)) return null;
    return result.status === 409 ? t.projectExists : t.projectCreateFailed;
  };

  return (
    <section aria-labelledby="dashboards-projects-title" className={styles.section}>
      <SectionStrip
        id="dashboards-projects-title"
        title={t.projectsTitle}
        count={status === 'ready' ? visible.length : undefined}
        action={
          status === 'ready' ? (
            <button type="button" className={styles.add} aria-expanded={creating} onClick={() => setCreating((open) => !open)}>
              <span aria-hidden="true">+</span> {t.newProject}
            </button>
          ) : undefined
        }
      />
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
              <section key={project.id} aria-labelledby={titleId} className={styles.card} data-scheme="project">
                <div className={styles.head}>
                  <ProjectTile name={project.name} icon={project.icon} />
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
          {creating && <NewProjectForm onCreate={createNamed} onClose={() => setCreating(false)} />}
          {visible.length === 0 && !creating && <p className={styles.none}>{t.noProjects}</p>}
        </div>
      )}
    </section>
  );
};

export default ProjectCards;
