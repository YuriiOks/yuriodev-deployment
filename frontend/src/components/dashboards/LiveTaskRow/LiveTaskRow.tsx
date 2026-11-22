import React, { useId, useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { dateLabel } from '../../../services/dashboards/calendarLabels';
import type { ApiError, LiveArea, LiveTask, TaskPatch } from '../../../services/dashboards/liveApi';
import { dueTone } from '../../../services/dashboards/taskGroups';
import { cx } from '../../../utils/cx';
import DashIcon from '../DashIcon/DashIcon';
import InlineError from '../InlineError/InlineError';
import rowStyles from '../PanelRow/PanelRow.module.css';
import TaskEditor from '../TaskEditor/TaskEditor';
import styles from './LiveTaskRow.module.css';

export interface LiveTaskRowProps {
  task: LiveTask;
  /** "YYYY-MM-DD": what "today" and "overdue" are measured against. */
  today: string;
  /** The space's life areas (personal): a row shows its area's name, and the editor can change it. */
  areas: readonly LiveArea[] | null;
  /** The last tick of this task was refused and rolled back. */
  failed: boolean;
  onToggle: (id: string) => void;
  onSave: (id: string, patch: TaskPatch) => Promise<ApiError | null>;
  onDelete: (id: string) => Promise<ApiError | null>;
}

/**
 * A real task as a row: the same structure as every row (lead checkbox, one-line title, plain meta, one
 * secondary button). The button opens the inline editor under the row; a refused tick shows an error line with a
 * retry. A done task is struck through and its urgency drops, as in the sample rows.
 */
const LiveTaskRow: React.FC<LiveTaskRowProps> = ({ task, today, areas, failed, onToggle, onSave, onDelete }) => {
  const { t, text } = useDashboardLang();
  const [editing, setEditing] = useState(false);
  const id = useId();
  const titleId = `${id}-title`;
  const editorId = `${id}-editor`;
  const done = task.status === 'done';
  const tone = done ? 'neutral' : dueTone(task.dueDate, today);
  const area = areas?.find((candidate) => candidate.id === task.areaId);
  const due = task.dueDate === null ? null : tone === 'danger' ? t.dueOverdue : tone === 'warn' ? t.dueToday : dateLabel(task.dueDate, t);

  return (
    <li className={cx(rowStyles.row, styles.row)} data-lead="true" data-done={done ? 'true' : undefined} data-editing={editing ? 'true' : undefined}>
      <span className={rowStyles.lead}>
        <label className={rowStyles.check}>
          <input type="checkbox" className={rowStyles.input} checked={done} aria-labelledby={titleId} onChange={() => onToggle(task.id)} />
          <span aria-hidden="true" className={rowStyles.box}>
            {done && <DashIcon name="check" size={14} />}
          </span>
          {task.priority && <span className="sr-only">{t.priorityRow}</span>}
        </label>
      </span>
      <span id={titleId} className={cx(rowStyles.title, done && rowStyles.done)} title={task.title}>
        {task.title}
      </span>
      {(area || due) && (
        <span className={rowStyles.meta}>
          {area && <span>{text({ ru: area.nameRu, en: area.nameEn })}</span>}
          {due && (
            <span className={rowStyles.due} data-tone={tone}>
              {tone === 'danger' && <DashIcon name="alert" size={14} />}
              {due}
            </span>
          )}
        </span>
      )}
      <button
        type="button"
        className={styles.edit}
        aria-expanded={editing}
        aria-controls={editing ? editorId : undefined}
        aria-label={`${t.editTask}: ${task.title}`}
        onClick={() => setEditing((open) => !open)}
      >
        {t.editTask}
      </button>
      {failed && (
        <div className={styles.full}>
          <InlineError message={t.toggleFailed} onRetry={() => onToggle(task.id)} />
        </div>
      )}
      {editing && (
        <div id={editorId} className={styles.full}>
          <TaskEditor
            task={task}
            areas={areas}
            onSave={(patch) => onSave(task.id, patch)}
            onDelete={() => onDelete(task.id)}
            onClose={() => setEditing(false)}
          />
        </div>
      )}
    </li>
  );
};

export default LiveTaskRow;
