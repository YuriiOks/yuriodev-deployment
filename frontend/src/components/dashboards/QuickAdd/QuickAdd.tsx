import React, { useRef, useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { useLimit } from '../../../hooks/useLimit';
import InlineError from '../InlineError/InlineError';
import styles from './QuickAdd.module.css';

export interface QuickAddProps {
  placeholder: string;
  /**
   * Creates the task from the text. Resolves to null on success (the field is cleared) or to the message to show
   * under the field (the text stays, and so does the focus). Left out, the field is visual only: Enter does nothing.
   */
  onSubmit?: (text: string) => Promise<string | null>;
}

/** The quick-add field. Plain text becomes the title; no parsing. With `onSubmit` Enter creates the task. */
const QuickAdd: React.FC<QuickAddProps> = ({ placeholder, onSubmit }) => {
  const { t } = useDashboardLang();
  const titleMax = useLimit('task', 'title', 300);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if (!onSubmit || text === '' || busy) return;
    setBusy(true);
    setError(null);
    const failure = await onSubmit(text);
    setBusy(false);
    if (failure === null) setValue('');
    else setError(failure);
    inputRef.current?.focus();
  };

  return (
    <div className={styles.wrap}>
      <form aria-label={t.quickAdd} className={styles.form} onSubmit={submit}>
        <span aria-hidden="true" className={styles.prompt}>
          &gt;
        </span>
        <input
          ref={inputRef}
          type="text"
          aria-label={placeholder}
          aria-busy={busy}
          aria-invalid={error ? true : undefined}
          placeholder={placeholder}
          className={styles.input}
          value={value}
          maxLength={titleMax}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
        />
      </form>
      {error && <InlineError message={error} />}
    </div>
  );
};

export default QuickAdd;
