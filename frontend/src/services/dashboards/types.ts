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
  | 'overview'
  | 'areas'
  | 'payments'
  | 'court'
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

/** Every glyph the dashboards draw: a tab or tool, a space, or a row marker. */
export type IconName = TabId | 'person' | 'scales' | 'building' | 'flag' | 'check' | 'alert' | 'prev' | 'next';

/** The colour of a glyph or a dot: a hue token, or the page's own accent / ink. */
export type DashTone = 'accent' | 'ink' | 'violet' | 'teal' | 'green' | 'blue' | 'orange' | 'pink' | 'red' | 'amber';

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
  readonly badge?: Localized;
  readonly badgeTone?: 'neutral' | 'accent';
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
  readonly tone: DashTone;
}

export interface Panel {
  readonly id: string;
  /** The tab it shows under. */
  readonly tab: TabId;
  readonly title: Localized;
  /** A short text at the right of the heading ("3 to sort"). */
  readonly note?: Localized;
  /** Show the number of rows as a pill next to the title. */
  readonly showCount?: boolean;
  /** The priority panel: the full row, its rows tinted. */
  readonly priority?: boolean;
  readonly rows: readonly Row[];
  readonly tiles?: readonly Tile[];
}

export interface CalendarEvent {
  readonly at: string;
  readonly title: Localized;
}

/** The "next event" block at the top of a space. */
export interface Hero {
  /** "NEXT TODAY" or "NEXT MEETING"; the space name is added after it. */
  readonly label: Localized;
  readonly at: string;
  readonly title: Localized;
  /** Time left, as text ("47:51"). */
  readonly countdown: string;
  /** A Join button, for a meeting that has a call. */
  readonly join?: boolean;
  /** The day's events, as chips. */
  readonly day: readonly CalendarEvent[];
  /** When each source was last read. */
  readonly sync: Localized;
}

export interface SpaceData {
  readonly id: SpaceId;
  readonly about: Localized;
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
