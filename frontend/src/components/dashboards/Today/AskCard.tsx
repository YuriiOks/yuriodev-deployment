import React, { useEffect, useId, useRef, useState } from 'react';
import { formatDate } from '../../../services/dashboards/dateFormat';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { useAssistant } from '../../../hooks/useAssistant';
import type { AssistantConfirm, AssistantScope } from '../../../services/dashboards/assistantApi';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { AssistantStrings } from '../../../services/dashboards/assistantStrings';
import styles from './Ask.module.css';

const LIMIT = 2000;
/** From this many characters the limit is shown (it is quiet until it matters). */
const SHOW_LIMIT_FROM = 1800;

/** A change's value as the owner reads it: a date, yes or no, a number, a text; nothing for what has no value. */
function valueText(value: unknown, s: AssistantStrings['confirm'], lang: string): string {
  if (value === null || value === undefined || value === '') return s.noValue;
  if (typeof value === 'boolean') return value ? s.yes : s.no;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(new Date(`${value}T12:00:00`), lang, { day: 'numeric', month: 'long', year: 'numeric' });
  return typeof value === 'string' ? value : s.noValue;
}

/** The rows of a write to confirm: for an event its local date, start and end (the instants in UTC are not shown); for the rest each change as a label and a value. */
function changeRows(confirm: AssistantConfirm, s: AssistantStrings['confirm'], lang: string): { label: string; value: string }[] {
  const label = (key: string) => s.labels[key] ?? key.replace(/_/g, ' ');
  if (confirm.action === 'add_event') {
    const c = confirm.changes;
    const rows = [
      { label: label('title'), value: valueText(c.title, s, lang) },
      { label: label('local_date'), value: valueText(c.local_date, s, lang) },
      { label: label('local_start'), value: valueText(c.local_start, s, lang) },
      { label: label('local_end'), value: valueText(c.local_end, s, lang) },
    ];
    if (typeof c.local_end_date === 'string' && c.local_end_date !== c.local_date) rows.push({ label: label('local_end_date'), value: valueText(c.local_end_date, s, lang) });
    return rows;
  }
  return Object.entries(confirm.changes)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({ label: label(key), value: valueText(value, s, lang) }));
}

const Confirm: React.FC<{ confirm: AssistantConfirm; busy: boolean; onDecide: (decision: 'approve' | 'decline') => void }> = ({ confirm, busy, onDecide }) => {
  const { t, lang } = useDashboardLang();
  const s = t.assistant.confirm;
  const rows = changeRows(confirm, s, lang);
  const inThePast = confirm.action === 'add_event' && confirm.changes.in_the_past === true;
  return (
    <div role="group" aria-label={s.title} className={styles.confirm}>
      <strong>{s.actions[confirm.action] ?? s.actionOther}</strong>
      {confirm.subject.name && <span className={styles.about}>{fill(s.about, { name: confirm.subject.name })}</span>}
      <dl className={styles.changes}>
        {rows.map((row) => (
          <div key={row.label} className={styles.change}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {inThePast && (
        <p role="alert" className={styles.warning}>
          {s.past}
        </p>
      )}
      <div className={styles.buttons}>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => onDecide('approve')}>
          {s.approve}
        </button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => onDecide('decline')}>
          {s.decline}
        </button>
      </div>
    </div>
  );
};

/**
 * "Ask Claude" on a Today view: a question box, three suggested questions, and the answer streaming in as plain text (line breaks kept, never
 * read as markup). A tool at work is a quiet line; Stop aborts; the conversation goes on for follow-ups until "New conversation". A write the
 * assistant wants to make is shown in words and happens only on Approve. Every refusal and failure is the page's own text.
 */
const AskCard: React.FC<{ scope: AssistantScope }> = ({ scope }) => {
  const { t } = useDashboardLang();
  const s = t.assistant;
  const assistant = useAssistant(scope);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const wasBusy = useRef(false);

  // Focus returns to the question box once an answer is in.
  useEffect(() => {
    if (wasBusy.current && !assistant.busy && !assistant.pending) input.current?.focus();
    wasBusy.current = assistant.busy;
  }, [assistant.busy, assistant.pending]);

  const submit = (text: string) => {
    const question = text.trim();
    if (!question || assistant.busy || assistant.pending) return;
    assistant.ask(question);
    setDraft('');
  };
  const last = assistant.turns[assistant.turns.length - 1];
  const locked = assistant.busy || assistant.pending !== null;
  return (
    <div className={styles.card} role="region" aria-label={s.title}>
      <h3 className={styles.title}>{s.title}</h3>
      {assistant.turns.length > 0 && (
        <div className={styles.log} role="log" aria-live="polite" aria-relevant="additions text">
          {assistant.turns.map((turn) => (
            <div key={turn.id} className={styles.turn}>
              <strong className={styles.question}>{turn.question}</strong>
              {turn.answer && <p className={styles.answer}>{turn.answer}</p>}
              {turn.stop === 'aborted' && <span className={styles.note}>{s.stopped}</span>}
              {turn.stop === 'cap' && <span className={styles.note}>{s.stops.cap}</span>}
              {turn.stop === 'refused' && <span className={styles.note}>{s.stops.refused}</span>}
              {turn.stop === 'length' && <span className={styles.note}>{s.stops.length}</span>}
            </div>
          ))}
        </div>
      )}
      {assistant.tool && (
        <p className={styles.note} role="status">
          {fill(s.working, { what: s.tools[assistant.tool] ?? s.toolOther })}
        </p>
      )}
      {assistant.pending && <Confirm confirm={assistant.pending} busy={assistant.busy} onDecide={assistant.decide} />}
      {assistant.problem && (
        <p role="alert" className={styles.problem}>
          {s.problems[assistant.problem]}
          {assistant.problem === 'failed' && assistant.lastQuestion && (
            <>
              {' '}
              <button type="button" className={styles.link} onClick={() => assistant.ask(assistant.lastQuestion ?? '')}>
                {s.retry}
              </button>
            </>
          )}
        </p>
      )}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <label htmlFor={`${id}-ask`} className="sr-only">
          {s.label}
        </label>
        <textarea
          ref={input}
          id={`${id}-ask`}
          className={styles.input}
          rows={2}
          maxLength={LIMIT}
          placeholder={s.placeholder}
          value={draft}
          disabled={locked}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit(draft);
            }
          }}
        />
        {assistant.busy ? (
          <button type="button" className={styles.secondary} onClick={assistant.stop}>
            {s.stop}
          </button>
        ) : (
          <button type="submit" className={styles.primary} aria-label={s.send} disabled={locked || draft.trim() === ''}>
            ↑
          </button>
        )}
      </form>
      {draft.length >= SHOW_LIMIT_FROM && <span className={styles.note}>{draft.length} / {LIMIT}</span>}
      {assistant.turns.length === 0 ? (
        <div className={styles.suggestions}>
          {s.suggestions[scope].map((text) => (
            <button key={text} type="button" className={styles.suggestion} disabled={locked} onClick={() => submit(text)}>
              {text}
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className={styles.link} disabled={assistant.busy && !last} onClick={assistant.reset}>
          {s.newConversation}
        </button>
      )}
      <span className={styles.note}>{assistant.remaining !== null ? fill(s.remaining, { n: assistant.remaining }) : s.help}</span>
    </div>
  );
};

export default AskCard;
