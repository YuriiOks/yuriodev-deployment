import React from 'react';
import styles from '../../../assets/styles/dashboard-forms.module.css';
import type { FieldIssues } from './fieldIssues';

/** The message under an input: the server's rule in the page's words. */
const FieldIssue: React.FC<{ issues: FieldIssues; field: string; id: string }> = ({ issues, field, id }) =>
  issues[field] ? (
    <span id={`${id}-${field}-issue`} className={styles.issue} role="alert">
      {issues[field]}
    </span>
  ) : null;

export default FieldIssue;
