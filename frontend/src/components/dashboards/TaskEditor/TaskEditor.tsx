import React, { useEffect, useId, useRef, useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import type { ApiError, LiveArea, LiveTask, TaskPatch } from '../../../services/dashboards/liveApi';
import InlineError from '../InlineError/InlineError';
import styles from './TaskEditor.module.css';

export interface TaskEditorProps {
  task: LiveTask;
  /** The life areas to choose from (the personal space); null for a space without them. */
  areas: readonly LiveArea[] | null;
  /** Saves the changed fields; resolves to null on success or the error to show. */
  onSave: (patch: TaskPatch) => Promise<ApiError | null>;
  onDelete: () => Promise<ApiError | null>;
  onClose: () => void;
}

/**
 * The inline editor of one task: title, notes, area (when the space has areas), priority, due date, save, cancel
 * and delete (which asks once more). Keyboard: the title is focused on open, Escape closes, Enter in a field saves.
 * Nothing is sent until Save; a failed save or delete stays open with an error line and keeps what was typed.
 */
const TaskEditor: React.FC<TaskEditorProps> = ({ task, areas, onSave, onDelete, onClose }) => {
  const { t, text } = useDashboardLang();
  const id = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [areaId, setAreaId] = useState(task.areaId ?? '');
  const [priority, setPriority] = useState(task.priority);
  const [due, setDue] = useState(task.dueDate ?? '');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = title.trim();
    if (trimmed === '') {
      setError(t.titleRequired);
      titleRef.current?.focus();
      return;
    }
    const patch: TaskPatch = {};
    if (trimmed !== task.title) patch.title = trimmed;
    if (notes !== task.notes) patch.notes = notes;
    if (areas && areaId !== (task.areaId ?? '')) patch.areaId = areaId === '' ? null : areaId;
    if (priority !== task.priority) patch.priority = priority;
    if (due !== (task.dueDate ?? '')) patch.dueDate = due === '' ? null : due;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await onSave(patch);
    setBusy(false);
    if (failure) setError(t.saveFailed);
    else onClose();
  };

  const remove = async () => {
    if (busy) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await onDelete();
    setBusy(false);
    if (failure) {
      setConfirming(false);
      setError(t.deleteFailed);
    }
  };

  return (
    <form
      className={styles.editor}
      aria-label={`${t.editTask}: ${task.title}`}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={styles.field}>
        <label htmlFor={`${id}-title`} className={styles.label}>
          {t.fieldTitle}
        </label>
        <input id={`${id}-title`} ref={titleRef} className={styles.input} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-notes`} className={styles.label}>
          {t.fieldNotes}
        </label>
        <textarea id={`${id}-notes`} className={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className={styles.pair}>
        {areas && (
          <div className={styles.field}>
            <label htmlFor={`${id}-area`} className={styles.label}>
              {t.fieldArea}
            </label>
            <select id={`${id}-area`} className={styles.select} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">{t.noArea}</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {text({ ru: area.nameRu, en: area.nameEn })}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className={styles.field}>
          <label htmlFor={`${id}-due`} className={styles.label}>
            {t.fieldDue}
          </label>
          <div className={styles.dueRow}>
            <input id={`${id}-due`} type="date" className={styles.input} value={due} onChange={(e) => setDue(e.target.value)} />
            {due !== '' && (
              <button type="button" className={styles.clear} onClick={() => setDue('')}>
                {t.clearDue}
              </button>
            )}
          </div>
        </div>
      </div>
      <label className={styles.check}>
        <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} />
        {t.fieldPriority}
      </label>
      {error && <InlineError message={error} />}
      <div className={styles.actions}>
        <button type="submit" className={styles.save} disabled={busy}>
          {busy ? t.pendingSave : t.save}
        </button>
        <button type="button" className={styles.cancel} onClick={onClose} disabled={busy}>
          {t.cancel}
        </button>
        <button type="button" className={styles.remove} onClick={remove} disabled={busy} data-confirming={confirming ? 'true' : undefined}>
          {confirming ? t.confirmDelete : t.deleteTask}
        </button>
      </div>
    </form>
  );
};

export default TaskEditor;
