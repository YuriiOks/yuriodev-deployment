import React from 'react';
import type { ApiError, LiveArea, LiveTask, TaskPatch } from '../../../services/dashboards/liveApi';
import LiveTaskRow from '../LiveTaskRow/LiveTaskRow';
import styles from '../Panel/Panel.module.css';

export interface TaskPanelProps {
  id: string;
  title: string;
  tasks: readonly LiveTask[];
  today: string;
  areas: readonly LiveArea[] | null;
  failed: ReadonlySet<string>;
  /** Shown instead of rows when there are none. */
  empty?: string;
  onToggle: (id: string) => void;
  onSave: (id: string, patch: TaskPatch) => Promise<ApiError | null>;
  onDelete: (id: string) => Promise<ApiError | null>;
}

/** A titled group of real tasks: Panel's head and list, with rows that can be ticked and edited. */
const TaskPanel: React.FC<TaskPanelProps> = ({ id, title, tasks, today, areas, failed, empty, onToggle, onSave, onDelete }) => {
  const titleId = `panel-${id}-title`;
  return (
    <section aria-labelledby={titleId} className={styles.panel}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {tasks.length > 0 && <span className={styles.count}>{tasks.length}</span>}
      </div>
      {tasks.length === 0 && empty && <p className={styles.empty}>{empty}</p>}
      {tasks.length > 0 && (
        <ul className={styles.rows}>
          {tasks.map((task) => (
            <LiveTaskRow
              key={task.id}
              task={task}
              today={today}
              areas={areas}
              failed={failed.has(task.id)}
              onToggle={onToggle}
              onSave={onSave}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

export default TaskPanel;
