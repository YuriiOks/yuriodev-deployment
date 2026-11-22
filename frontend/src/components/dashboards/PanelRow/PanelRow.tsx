import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import type { Row } from '../../../services/dashboards/types';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import styles from './PanelRow.module.css';

export interface PanelRowProps {
  row: Row;
  /** The panel has a lead column (a checkbox or a CI icon on some row): this row reserves it too. */
  lead: boolean;
  /** A task's current state (its own `done`, or what the visitor set). */
  done: boolean;
  onToggle: (id: string) => void;
}

/**
 * One row, the same structure in every panel: 40px, one line. A 24px lead column when the panel has one (a
 * task's checkbox, a pull request's CI icon); the title, a single line with an ellipsis (the whole title is in
 * the tooltip); then a right-aligned group of plain text (the meta line, a status in words, the due date) and
 * at most one button. A due date is text: "overdue" in the danger colour with an alert icon, "today" in warn,
 * a later date plain. Nothing in a row has a border, a fill or a capsule. On a phone the group moves under the
 * title and the title may take two lines.
 */
const PanelRow: React.FC<PanelRowProps> = ({ row, lead, done, onToggle }) => {
  const { t, text } = useDashboardLang();
  const titleId = `row-${row.id}-title`;
  const isTask = row.kind === 'task';
  const finished = isTask && done;
  const dueTone = finished ? 'neutral' : (row.due?.tone ?? 'neutral');
  const fullTitle = `${row.ref ? `${row.ref} ` : ''}${text(row.title)}`;
  const actionLabel = row.action ? `${t.actions[row.action.verb]} · ${t.tabs[row.action.tool]}` : '';
  const hasMeta = Boolean(row.meta || row.badge || row.due);

  return (
    <li className={cx(styles.row, isTask && styles.task)} data-done={finished ? 'true' : undefined} data-lead={lead ? 'true' : undefined}>
      {lead && (
        <span className={styles.lead}>
          {row.kind === 'task' && (
            <label className={styles.check}>
              <input
                type="checkbox"
                className={styles.input}
                checked={done}
                aria-labelledby={titleId}
                onChange={() => onToggle(row.id)}
              />
              <span aria-hidden="true" className={styles.box}>
                {done && <DashIcon name="check" size={14} />}
              </span>
              {row.priority && <span className="sr-only">{t.priorityRow}</span>}
            </label>
          )}
          {row.kind === 'pr' && (
            <>
              <span aria-hidden="true" className={styles.ci} data-ci={row.ci}>
                <DashIcon name={row.ci === 'pass' ? 'circle-check' : 'circle-x'} size={14} />
              </span>
              <span className="sr-only">{row.ci === 'pass' ? t.ciPass : t.ciFail}</span>
            </>
          )}
        </span>
      )}

      <span id={titleId} className={cx(styles.title, finished && styles.done)} title={fullTitle}>
        {row.ref && (
          <>
            <a
              href={row.refHref}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.ref}
              aria-label={`${row.ref} (${t.opensInNewTab})`}
            >
              {row.ref}
            </a>{' '}
          </>
        )}
        {text(row.title)}
      </span>

      {hasMeta && (
        <span className={styles.meta}>
          {row.meta && <span>{text(row.meta)}</span>}
          {row.badge && (
            <span className={styles.status} data-tone={row.badgeTone ?? 'neutral'}>
              {text(row.badge)}
            </span>
          )}
          {row.due && (
            <span className={styles.due} data-tone={dueTone}>
              {dueTone === 'danger' && <DashIcon name="alert" size={14} />}
              {text(row.due.label)}
            </span>
          )}
        </span>
      )}

      {row.action &&
        (row.action.href ? (
          <a
            href={row.action.href}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.action}
            aria-label={`${actionLabel} (${t.opensInNewTab})`}
          >
            {t.actions[row.action.verb]}
          </a>
        ) : (
          // The sample data has no thread or ticket to open, so the button does nothing yet.
          <button type="button" className={styles.action} title={t.notConnected} aria-label={actionLabel}>
            {t.actions[row.action.verb]}
          </button>
        ))}
    </li>
  );
};

export default PanelRow;
