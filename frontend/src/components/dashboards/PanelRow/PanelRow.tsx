import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { TAB_TONE } from '../../../services/dashboards/spaces';
import type { Row, TabId } from '../../../services/dashboards/types';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import styles from './PanelRow.module.css';

export interface PanelRowProps {
  row: Row;
  /** The tab of the panel the row is in: its icon marks a row with no checkbox or CI dot. */
  tab: TabId;
  /** A task's current state (its own `done`, or what the visitor set). */
  done: boolean;
  onToggle: (id: string) => void;
  /** In a priority panel: the row is tinted (until it is done). */
  tinted?: boolean;
}

/**
 * One row, the same system for every kind. A leading column of fixed width
 * that is never empty: a task's checkbox, a pull request's CI dot, or a small
 * neutral marker (the source's icon, or a bullet on the overview). Then the
 * title, one line with an ellipsis (the whole title is in the tooltip and the
 * accessible name), over the source line; and at most ONE trailing element:
 * the action if there is one, else the badge, else the due chip. What it
 * displaces moves into the source line as plain text (a due date keeps a
 * coloured dot for its urgency). A done task drops its tint and its urgency.
 */
const PanelRow: React.FC<PanelRowProps> = ({ row, tab, done, onToggle, tinted = false }) => {
  const { t, text } = useDashboardLang();
  const titleId = `row-${row.id}-title`;
  const isTask = row.kind === 'task';
  const finished = isTask && done;
  const trailing = row.action ? 'action' : row.badge ? 'badge' : row.due ? 'due' : null;
  const dueTone = finished ? 'neutral' : (row.due?.tone ?? 'neutral');
  const fullTitle = `${row.ref ? `${row.ref} ` : ''}${text(row.title)}`;
  const markerIcon = row.action?.tool ?? tab;

  return (
    <li className={cx(styles.row, tinted && !finished && styles.tinted, isTask && styles.task)} data-done={finished ? 'true' : undefined}>
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
              {done && <DashIcon name="check" size={12} strokeWidth={3.5} />}
            </span>
            {row.priority && <span className="sr-only">{t.priorityRow}</span>}
          </label>
        )}
        {row.kind === 'pr' && (
          <>
            <span aria-hidden="true" className={styles.dot} data-ci={row.ci} />
            <span className="sr-only">{row.ci === 'pass' ? t.ciPass : t.ciFail}</span>
          </>
        )}
        {row.kind === 'info' &&
          (markerIcon === 'overview' ? (
            <span aria-hidden="true" className={styles.bullet} />
          ) : (
            <DashIcon name={markerIcon} size={16} className={styles.marker} />
          ))}
      </span>

      <div className={styles.body}>
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
        {(row.meta || (row.badge && trailing !== 'badge') || (row.due && trailing !== 'due')) && (
          <span className={styles.source}>
            {row.meta && <span className={styles.meta}>{text(row.meta)}</span>}
            {row.badge && trailing !== 'badge' && <span className={styles.meta}>{text(row.badge)}</span>}
            {row.due && trailing !== 'due' && (
              <span className={cx(styles.meta, styles.dueInline)} data-tone={dueTone}>
                {text(row.due.label)}
              </span>
            )}
          </span>
        )}
      </div>

      {trailing === 'action' && row.action && (
        <span className={styles.trail}>
          {row.action.href ? (
            <a
              href={row.action.href}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.action}
              aria-label={`${t.actions[row.action.verb]} · ${t.tabs[row.action.tool]} (${t.opensInNewTab})`}
            >
              <DashIcon name={row.action.tool} size={16} tone={TAB_TONE[row.action.tool]} strokeWidth={1.9} />
              <span>{t.actions[row.action.verb]}</span>
            </a>
          ) : (
            // The sample data has no thread or ticket to open, so the button does nothing yet.
            <button
              type="button"
              className={styles.action}
              title={t.notConnected}
              aria-label={`${t.actions[row.action.verb]} · ${t.tabs[row.action.tool]}`}
            >
              <DashIcon name={row.action.tool} size={16} tone={TAB_TONE[row.action.tool]} strokeWidth={1.9} />
              <span>{t.actions[row.action.verb]}</span>
            </button>
          )}
        </span>
      )}
      {trailing === 'badge' && row.badge && (
        <span className={styles.trail}>
          <span className={styles.badge} data-tone={row.badgeTone ?? 'neutral'}>
            {text(row.badge)}
          </span>
        </span>
      )}
      {trailing === 'due' && row.due && (
        <span className={styles.trail}>
          <span className={styles.due} data-tone={dueTone}>
            {text(row.due.label)}
          </span>
        </span>
      )}
    </li>
  );
};

export default PanelRow;
