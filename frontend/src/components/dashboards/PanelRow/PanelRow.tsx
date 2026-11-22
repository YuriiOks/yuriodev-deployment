import React from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { TAB_TONE } from '../../../services/dashboards/spaces';
import type { Row } from '../../../services/dashboards/types';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import styles from './PanelRow.module.css';

export interface PanelRowProps {
  row: Row;
  /** A task's current state (its own `done`, or what the visitor set). */
  done: boolean;
  onToggle: (id: string) => void;
  /** In a priority panel: the row is tinted. */
  tinted?: boolean;
}

/**
 * One row, the same system for every kind: a fixed-width leading column (a
 * task's checkbox, a pull request's CI dot, or an empty spacer, so titles line
 * up), the title with the small source line under it, and at most ONE
 * trailing element. The trailing one is the action if there is one, else the
 * badge, else the due chip; whatever it displaces moves into the source line
 * as a small chip.
 */
const PanelRow: React.FC<PanelRowProps> = ({ row, done, onToggle, tinted = false }) => {
  const { t, text } = useDashboardLang();
  const titleId = `row-${row.id}-title`;
  const isTask = row.kind === 'task';
  const trailing = row.action ? 'action' : row.badge ? 'badge' : row.due ? 'due' : null;

  return (
    <li className={cx(styles.row, tinted && styles.tinted)}>
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
      </span>

      <div className={styles.body}>
        <span id={titleId} className={cx(styles.title, isTask && done && styles.done)}>
          {row.ref && (
            <>
              <a href={row.refHref} target="_blank" rel="noopener noreferrer" className={styles.ref}>
                {row.ref}{' '}
                <span className="sr-only">({t.opensInNewTab})</span>
              </a>{' '}
            </>
          )}
          {text(row.title)}
        </span>
        {(row.meta || (row.badge && trailing !== 'badge') || (row.due && trailing !== 'due')) && (
          <span className={styles.source}>
            {row.meta && <span className={styles.meta}>{text(row.meta)}</span>}
            {row.badge && trailing !== 'badge' && (
              <span className={styles.chip} data-tone={row.badgeTone ?? 'neutral'}>
                {text(row.badge)}
              </span>
            )}
            {row.due && trailing !== 'due' && (
              <span className={styles.chip} data-tone={row.due.tone ?? 'neutral'}>
                {text(row.due.label)}
              </span>
            )}
          </span>
        )}
      </div>

      {trailing === 'action' && row.action && (
        <span className={styles.trail}>
          {row.action.href ? (
            <a href={row.action.href} target="_blank" rel="noopener noreferrer" className={styles.action}>
              <DashIcon name={row.action.tool} size={16} tone={TAB_TONE[row.action.tool]} strokeWidth={1.9} />
              <span>{t.actions[row.action.verb]}</span>{' '}
              <span className="sr-only">· {t.tabs[row.action.tool]} ({t.opensInNewTab})</span>
            </a>
          ) : (
            // The sample data has no thread or ticket to open, so the button does nothing yet.
            <button type="button" className={styles.action} title={t.notConnected}>
              <DashIcon name={row.action.tool} size={16} tone={TAB_TONE[row.action.tool]} strokeWidth={1.9} />
              <span>{t.actions[row.action.verb]}</span>{' '}
              <span className="sr-only">· {t.tabs[row.action.tool]}</span>
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
          <span className={styles.due} data-tone={row.due.tone ?? 'neutral'}>
            {text(row.due.label)}
          </span>
        </span>
      )}
    </li>
  );
};

export default PanelRow;
