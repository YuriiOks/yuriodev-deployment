import React from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../../utils/cx';
import styles from './Today.module.css';

/** One action of a card: a button, or a link when it only goes somewhere. */
export interface TodayAction {
  readonly label: string;
  readonly onClick?: () => void;
  readonly to?: string;
  /** An address outside the page (a pull request, an issue): opened in a new tab. */
  readonly href?: string;
  readonly busy?: boolean;
}

export interface TodayQueueItem {
  readonly key: string;
  /** The mark of what it is about (a bank's mark, a payment's picture). */
  readonly icon: React.ReactNode;
  /** The decision to make, phrased as a question. */
  readonly title: string;
  /** One line of fact. */
  readonly fact: string;
  readonly primary: TodayAction;
  readonly secondary: TodayAction;
  /** `high`, `medium` or `info`: told by an edge on the card and a word the caller puts in the fact; never colour alone. */
  readonly severity: 'high' | 'medium' | 'info';
}

export interface TodaySoonItem {
  readonly key: string;
  /** The payment's picture or colour tile. */
  readonly icon?: React.ReactNode;
  readonly name: string;
  readonly chips: readonly string[];
  readonly action: TodayAction;
  readonly late?: boolean;
}

export interface TodayStat {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly note: string;
}

export interface TodayBreakdownRow {
  readonly key: string;
  readonly icon?: React.ReactNode;
  readonly name: string;
  readonly value: string;
  /** 0 to 100: the bar, scaled to the largest row. */
  readonly width: number;
}

export interface TodayProps {
  /** The space's own mark and name, at the top left. */
  readonly mark: React.ReactNode;
  readonly place: string;
  /** The place is the page's h1 (a page with no heading of its own); else it is plain strong text. */
  readonly placeIsHeading?: boolean;
  /** The section tabs (the caller's own nav). */
  readonly nav: React.ReactNode;
  /** Quiet controls at the far right of the same row (when the data was read, Refresh, a display switch). */
  readonly controls?: React.ReactNode;
  /** Where the mark leads (the page above: the way back, so no "Back to" link is needed). */
  readonly markTo?: { readonly to: string; readonly label: string };
  readonly hello: string;
  /** The one sentence that says what matters now. */
  readonly summary: string;
  readonly queue: {
    readonly title: string;
    readonly count: number;
    readonly countLabel?: string;
    readonly countTo?: string;
    /** The cards (`TodayCard`), at most three; none shows the empty line. */
    readonly cards: React.ReactNode;
    readonly shown: number;
    readonly empty: string;
    readonly oneAtATime: TodayAction | null;
  };
  readonly soon: { readonly title: string; readonly linkLabel: string; readonly linkTo: string; readonly rows: React.ReactNode; readonly shown: number; readonly empty: string };
  readonly stats: readonly TodayStat[];
  readonly breakdown: {
    readonly title: string;
    readonly period: string;
    readonly rows: readonly TodayBreakdownRow[];
    readonly insight: { readonly title: string; readonly text: string } | null;
    readonly empty: string;
  };
  /** The right column: cards of the caller's (Today's list of banks, and later Ask and the streak where the backend serves them). */
  readonly side: React.ReactNode;
}

const Action: React.FC<{ action: TodayAction; kind: 'primary' | 'secondary' | 'quiet' }> = ({ action, kind }) => {
  const className = cx(styles.action, kind === 'primary' && styles.actionPrimary, kind === 'secondary' && styles.actionSecondary, kind === 'quiet' && styles.actionQuiet);
  if (action.href) {
    return (
      <a className={className} href={action.href} target="_blank" rel="noopener noreferrer">
        {action.label}
      </a>
    );
  }
  if (action.to) {
    return (
      <Link className={className} to={action.to}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" className={className} disabled={action.busy} onClick={action.onClick}>
      {action.label}
    </button>
  );
};

/**
 * The Today view of a space: the same structure on every page. Top: the space's mark and name, its section tabs, a greeting and one sentence
 * that says what matters now. Left: "First this" (at most three decisions, each with exactly two actions, and a way to walk through them one
 * at a time) and a short "due soon" list. Middle: two big figures and one breakdown that ends in a finding. Right: the caller's own cards.
 * Presentational only: it is given everything it shows.
 */
const TodayLayout: React.FC<TodayProps> = ({ mark, place, placeIsHeading = false, nav, controls, markTo, hello, summary, queue, soon, stats, breakdown, side }) => (
  <div className={styles.today}>
    <header className={styles.top}>
      <div className={styles.space}>
        {markTo ? (
          <Link className={styles.markLink} to={markTo.to} aria-label={markTo.label}>
            <span aria-hidden="true" className={styles.mark}>
              {mark}
            </span>
          </Link>
        ) : (
          <span aria-hidden="true" className={styles.mark}>
            {mark}
          </span>
        )}
        {placeIsHeading ? <h1 className={styles.place}>{place}</h1> : <strong className={styles.place}>{place}</strong>}
      </div>
      {nav}
      {controls && <div className={styles.controls}>{controls}</div>}
    </header>
    <div className={styles.intro}>
      <h2 className={styles.hello}>
        <span aria-hidden="true" className={styles.hash}>
          #{' '}
        </span>
        {hello}
      </h2>
      <p className={styles.summary}>{summary}</p>
    </div>
    <div className={styles.columns}>
      <section aria-labelledby="today-queue" className={styles.column}>
        <div className={styles.sectionHead}>
          <h3 id="today-queue" className={styles.sectionTitle}>
            {queue.title}
            {queue.countTo ? (
              <Link className={styles.count} to={queue.countTo} aria-label={queue.countLabel}>
                {queue.count}
              </Link>
            ) : (
              <span className={styles.count}>{queue.count}</span>
            )}
          </h3>
          {queue.oneAtATime && <Action action={queue.oneAtATime} kind="primary" />}
        </div>
        {queue.shown === 0 ? <p className={styles.empty}>{queue.empty}</p> : <ul className={styles.list}>{queue.cards}</ul>}
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>{soon.title}</h3>
          <Link className={styles.link} to={soon.linkTo}>
            {soon.linkLabel}
          </Link>
        </div>
        {soon.shown === 0 ? <p className={styles.empty}>{soon.empty}</p> : <ul className={styles.list}>{soon.rows}</ul>}
      </section>
      <section aria-label={breakdown.title} className={styles.column}>
        <div className={styles.stats}>
          {stats.map((stat, index) => (
            <div key={stat.key} className={styles.stat} data-tone={index % 2 === 0 ? 'a' : 'b'}>
              <span className={styles.statLabel}>{stat.label}</span>
              <strong className={styles.statValue}>
                {/* Several currencies are told one to a line, never one long figure. */}
                {stat.value.split(' · ').map((part) => (
                  <span key={part} className={styles.statPart}>
                    {part}
                  </span>
                ))}
              </strong>
              <span className={styles.statNote}>{stat.note}</span>
            </div>
          ))}
        </div>
        <div className={styles.breakdown}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>{breakdown.title}</h3>
            <span className={styles.chip}>{breakdown.period}</span>
          </div>
          {breakdown.rows.length === 0 ? (
            <p className={styles.empty}>{breakdown.empty}</p>
          ) : (
            <ul className={styles.bars}>
              {breakdown.rows.map((row) => (
                <li key={row.key} className={styles.bar}>
                  <div className={styles.barTop}>
                    <span className={styles.barName}>
                      {row.icon}
                      {row.name}
                    </span>
                    <strong>{row.value}</strong>
                  </div>
                  <div aria-hidden="true" className={styles.track}>
                    <div className={styles.fill} style={{ width: `${row.width}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {breakdown.insight && (
            <div className={styles.insight}>
              <strong>{breakdown.insight.title}</strong>
              <span>{breakdown.insight.text}</span>
            </div>
          )}
        </div>
      </section>
      <section aria-label="" className={styles.column}>
        {side}
      </section>
    </div>
  </div>
);

export default TodayLayout;

/** A card of the right column: a title, an optional link to the full view, and rows. */
export const SideCard: React.FC<{ title: string; linkLabel?: string; linkTo?: string; children: React.ReactNode }> = ({ title, linkLabel, linkTo, children }) => (
  <div className={styles.sideCard} role="region" aria-label={title}>
    <div className={styles.sectionHead}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {linkTo && linkLabel && (
        <Link className={styles.link} to={linkTo}>
          {linkLabel}
        </Link>
      )}
    </div>
    {children}
  </div>
);

/** One row of a side card: when (small) over what (strong). */
export const SideRow: React.FC<{ when: string; what: string; icon?: React.ReactNode }> = ({ when, what, icon }) => (
  <div className={styles.sideRow}>
    {icon && <span className={styles.sideIcon}>{icon}</span>}
    <span className={styles.sideText}>
      <span className={styles.sideWhen}>{when}</span>
      <strong>{what}</strong>
    </span>
  </div>
);

/** One decision of the queue: a mark, the question, one line of fact, and exactly two actions. */
export const TodayCard: React.FC<{ item: TodayQueueItem }> = ({ item }) => (
  <li className={styles.card} data-severity={item.severity} data-key={item.key}>
    <span className={styles.cardIcon}>{item.icon}</span>
    <div className={styles.cardBody}>
      <strong className={styles.cardTitle}>{item.title}</strong>
      <span className={styles.cardFact}>{item.fact}</span>
    </div>
    <div className={styles.cardActions}>
      <Action action={item.primary} kind="primary" />
      <Action action={item.secondary} kind="secondary" />
    </div>
  </li>
);

/** One row of "due soon": the name, two small chips and one action. */
export const TodaySoonRow: React.FC<{ item: TodaySoonItem }> = ({ item }) => (
  <li className={styles.soon} data-late={item.late ? 'true' : undefined}>
    {item.icon && <span className={styles.soonIcon}>{item.icon}</span>}
    <div className={styles.soonMain}>
      <strong>{item.name}</strong>
      <span className={styles.chips}>
        {item.chips.map((chip) => (
          <span key={chip} className={styles.chip}>
            {chip}
          </span>
        ))}
      </span>
    </div>
    <Action action={item.action} kind="quiet" />
  </li>
);
