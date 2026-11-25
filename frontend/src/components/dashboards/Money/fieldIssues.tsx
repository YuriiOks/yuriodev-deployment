import React from 'react';
import { refusal, refusalFields } from '../../../services/dashboards/recurringApi';
import type { RefusalStrings } from '../../../services/dashboards/refusalStrings';
import styles from '../../../assets/styles/dashboard-forms.module.css';

/** The server's words for a refusal, by the field they are about (the field's name as the server sends it). */
export type FieldIssues = Readonly<Record<string, string>>;

export const NO_ISSUES: FieldIssues = {};

/**
 * Splits a refusal: the broken rules of the fields this form shows go under their own inputs (`issues`, the first rule of each field); whatever
 * is left (a rule of a field the form does not show, a refusal with a code only) is the words for the form's one alert (`other`, or null).
 */
export function splitRefusal(error: unknown, words: RefusalStrings, shown: readonly string[]): { issues: FieldIssues; other: string | null } {
  const issues: Record<string, string> = {};
  const left: string[] = [];
  for (const { field, sentence } of refusalFields(error, words)) {
    if (shown.includes(field)) issues[field] ??= sentence;
    else left.push(field && Object.prototype.hasOwnProperty.call(words.fields, field) ? `${words.fields[field]}: ${sentence}` : sentence);
  }
  if (Object.keys(issues).length === 0) return { issues, other: refusal(error, words) };
  return { issues, other: left.length > 0 ? left.slice(0, 3).join('; ') : null };
}

/** The attributes an input takes while it has a broken rule: invalid, and described by the message under it (with whatever hint it already has). */
export function issueProps(issues: FieldIssues, field: string, id: string, hint?: string): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  const described = [hint, issues[field] ? `${id}-${field}-issue` : undefined].filter(Boolean).join(' ');
  return { ...(issues[field] ? { 'aria-invalid': true as const } : {}), ...(described ? { 'aria-describedby': described } : {}) };
}

/** The message under an input: the server's rule in the page's words. */
export const FieldIssue: React.FC<{ issues: FieldIssues; field: string; id: string }> = ({ issues, field, id }) =>
  issues[field] ? (
    <span id={`${id}-${field}-issue`} className={styles.issue} role="alert">
      {issues[field]}
    </span>
  ) : null;
