/**
 * The shapes of the private dashboards: three spaces (Personal, Work 1, Work 2),
 * each a set of source tabs holding panels of rows, plus one shared week of
 * events. Pure types: sampleData.ts fills them today, and a later API call
 * can fill them without any component changing (see source.ts).
 */

export type Lang = 'ru' | 'en';

/** A text in both languages; a component picks one with the language context's `text()`. */
export interface Localized {
  readonly ru: string;
  readonly en: string;
}

export type SpaceId = 'personal' | 'work-1' | 'work-2';

/** One source tab. 'overview' is every space's first tab. */
export type TabId =
  | 'today'
  | 'overview'
  | 'areas'
  | 'payments'
  | 'work'
  | 'mail'
  | 'telegram'
  | 'github'
  | 'linear'
  | 'slack'
  | 'notion'
  | 'posthog'
  | 'grafana'
  | 'meetings'
  | 'jira'
  | 'teams';

/** Every glyph the dashboards draw: one stroke set, no tool logos and no space pictograms. */
export type IconName = 'check' | 'circle-check' | 'circle-x' | 'alert' | 'prev' | 'next' | 'sun' | 'moon' | 'arrow-right' | 'eye-off';

export type DueTone = 'neutral' | 'warn' | 'danger';

/** A date or a status at the end of a row ("today", "In Progress", "0%"). */
export interface Due {
  readonly label: Localized;
  readonly tone?: DueTone;
}

export type ActionVerb = 'reply' | 'ask' | 'open' | 'restore';

/** The small button on a row: what to do and in which tool. */
export interface RowAction {
  readonly verb: ActionVerb;
  readonly tool: TabId;
  /** Where it goes; left out, the tool's own home page is used. */
  readonly href?: string;
}

export interface RowBase {
  /** Unique within its space: the done state is kept by it. */
  readonly id: string;
  readonly title: Localized;
  /** A reference in front of the title ("#123"), linked to `refHref`. */
  readonly ref?: string;
  readonly refHref?: string;
  /** The secondary line: the source, an amount, a time. */
  readonly meta?: Localized;
  /** A status in words at the end of the row ("CI failing", "junk"): plain text, never a capsule. */
  readonly badge?: Localized;
  readonly badgeTone?: 'neutral' | 'danger';
  readonly action?: RowAction;
  readonly due?: Due;
}

/** Something to do: a checkbox, toggled locally. */
export interface TaskRow extends RowBase {
  readonly kind: 'task';
  readonly done?: boolean;
  /** Flagged and tinted; a priority panel holds only these. */
  readonly priority?: boolean;
}

/** A pull request: a CI dot in front. */
export interface PullRequestRow extends RowBase {
  readonly kind: 'pr';
  readonly ci: 'pass' | 'fail';
}

/** Information only: no checkbox, no dot. */
export interface InfoRow extends RowBase {
  readonly kind: 'info';
}

export type Row = TaskRow | PullRequestRow | InfoRow;

/** One tile of the life-areas panel: an area and how many tasks are open in it. */
export interface Tile {
  readonly id: string;
  readonly name: Localized;
  readonly count: number;
}

export interface Panel {
  readonly id: string;
  /** The tab it shows under. */
  readonly tab: TabId;
  readonly title: Localized;
  /** A short text at the right of the heading ("3 to sort"). */
  readonly note?: Localized;
  /** The priority panel: the first, main list of the overview. */
  readonly priority?: boolean;
  readonly rows: readonly Row[];
  /** Shown, muted, when the panel has no rows yet (not counted as an item). */
  readonly empty?: Localized;
  readonly tiles?: readonly Tile[];
}

export interface CalendarEvent {
  readonly at: string;
  readonly title: Localized;
}

/** The next event, as the one-line strip at the top of a space. */
export interface Hero {
  /** A date in words ("24 November") when the event is not today: shown in the interface face before the time. */
  readonly date?: string;
  readonly at: string;
  readonly title: Localized;
  /** Whole minutes until it starts (shown as "in 47 min"; never seconds). */
  readonly minutesLeft: number;
  /** A Join button, for a meeting that has a call. */
  readonly join?: boolean;
  /** The day's events: the one after the next is shown as "then 13:00 ...". */
  readonly day: readonly CalendarEvent[];
  /** When each source was last read: the page footer's "Synced:" line. */
  readonly sync: Localized;
}

export interface SpaceData {
  readonly id: SpaceId;
  readonly hero: Hero;
  readonly quickAddPlaceholder: Localized;
  /** The source tabs, in order; 'overview' first. */
  readonly tabs: readonly TabId[];
  readonly panels: readonly Panel[];
}

/** One calendar event: a date ("YYYY-MM-DD"), a start and an end ("HH:MM") on it, and its space. */
export interface CalEvent {
  readonly id: string;
  readonly date: string;
  readonly start: string;
  readonly end: string;
  readonly title: Localized;
  readonly space: SpaceId;
  /** A line under the title (the "Focus time" note). */
  readonly note?: Localized;
}

export interface CalendarData {
  /** The date shown as today ("YYYY-MM-DD"). */
  readonly today: string;
  /** The hours the week grid shows, first to last, as "HH:00". */
  readonly hours: readonly string[];
  readonly events: readonly CalEvent[];
}

/** What the entrance shows for one space. */
export interface SpaceSummary {
  readonly open: number;
  readonly priority: number;
  readonly overdue: number;
}
