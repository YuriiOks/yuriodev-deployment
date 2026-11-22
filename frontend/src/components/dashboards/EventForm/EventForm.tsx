import React, { useEffect, useId, useRef, useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { SPACES, SPACE_NAME } from '../../../services/dashboards/spaces';
import type { SpaceId } from '../../../services/dashboards/types';
import InlineError from '../InlineError/InlineError';
import styles from './EventForm.module.css';

export interface NewEvent {
  readonly space: SpaceId;
  readonly title: string;
  /** "YYYY-MM-DD", and "HH:MM" start and end, all local. */
  readonly date: string;
  readonly start: string;
  readonly end: string;
  readonly busyOnly: boolean;
}

export interface EventFormProps {
  /** The date the form starts on. */
  today: string;
  /** Creates the event; resolves to null on success or the message to show. */
  onSubmit: (event: NewEvent) => Promise<string | null>;
  onClose: () => void;
}

/**
 * The "New event" form: title, date, start, end, the space, and whether the other spaces show it as Focus time.
 * Nothing is sent until Add; a refusal or a failure keeps the form open with one error line. Escape closes it.
 */
const EventForm: React.FC<EventFormProps> = ({ today, onSubmit, onClose }) => {
  const { t, text } = useDashboardLang();
  const id = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('11:00');
  const [space, setSpace] = useState<SpaceId>('personal');
  const [busyOnly, setBusyOnly] = useState(false);
  const [busy, setBusy] = useState(false);
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
    if (date === '' || start === '' || end === '' || end <= start) {
      setError(t.evInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await onSubmit({ space, title: trimmed, date, start, end, busyOnly });
    setBusy(false);
    if (failure) setError(failure);
  };

  return (
    <form
      className={styles.form}
      aria-label={t.newEvent}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className={styles.grid}>
        <div className={styles.wide}>
          <label htmlFor={`${id}-title`} className={styles.label}>
            {t.evTitle}
          </label>
          <input id={`${id}-title`} ref={titleRef} className={styles.input} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-date`} className={styles.label}>
            {t.evDate}
          </label>
          <input id={`${id}-date`} type="date" className={styles.input} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-start`} className={styles.label}>
            {t.evStart}
          </label>
          <input id={`${id}-start`} type="time" className={styles.input} value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-end`} className={styles.label}>
            {t.evEnd}
          </label>
          <input id={`${id}-end`} type="time" className={styles.input} value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-space`} className={styles.label}>
            {t.evSpace}
          </label>
          <select id={`${id}-space`} className={styles.select} value={space} onChange={(e) => setSpace(e.target.value as SpaceId)}>
            {SPACES.map((option) => (
              <option key={option} value={option}>
                {text(SPACE_NAME[option])}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className={styles.check}>
        <input type="checkbox" checked={busyOnly} onChange={(e) => setBusyOnly(e.target.checked)} />
        {t.evBusy}
      </label>
      {error && <InlineError message={error} />}
      <div className={styles.actions}>
        <button type="submit" className={styles.add} disabled={busy}>
          {busy ? t.pendingSave : t.evAdd}
        </button>
        <button type="button" className={styles.cancel} onClick={onClose} disabled={busy}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
};

export default EventForm;
