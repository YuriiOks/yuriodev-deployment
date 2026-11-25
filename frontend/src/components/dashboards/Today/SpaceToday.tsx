import React, { useEffect, useRef, useState } from 'react';
import { useDashboardLang } from '../../../context/useDashboardLang';
import { useSpaceNames } from '../../../hooks/useSpaceNames';
import { pagePath } from '../../../data/site';
import type { TodayData, TodayEvent, TodayQueueEntry, TodaySoonEntry } from '../../../services/dashboards/todayApi';
import { formatDate } from '../../../services/dashboards/dateFormat';
import { fill } from '../../../services/dashboards/calendarLabels';
import type { LiveArea } from '../../../services/dashboards/liveApi';
import { splitIso } from '../../../services/dashboards/liveTime';
import type { SpaceTodayStrings } from '../../../services/dashboards/spaceTodayStrings';
import type { SpaceId, TabId } from '../../../services/dashboards/types';
import AreaIcon from '../AreaIcon/AreaIcon';
import ProjectIcon from '../ProjectIcon/ProjectIcon';
import { areaIconName } from '../../../services/dashboards/areaIcons';
import SpaceTile from '../SpaceTile/SpaceTile';
import AskCard from './AskCard';
import StreakCard from './StreakCard';
import { partOfDay } from '../Money/todayModel';
import styles from './Today.module.css';
import TodayLayout, { SideCard, SideRow, TodayCard, TodaySoonRow, type TodayAction } from './TodayLayout';

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** A wait in hours as hours (under two days) or days. */
function waited(hours: number | null, s: SpaceTodayStrings): string {
  if (hours === null) return '';
  return hours < 48 ? fill(s.hours, { n: Math.max(hours, 1) }) : fill(s.days, { n: Math.round(hours / 24) });
}

/** A due date as a chip: today, tomorrow, else the date. */
function dueChip(due: string | null, daysUntil: number | null, s: SpaceTodayStrings, lang: string): string {
  if (!due) return '';
  if (daysUntil === 0) return s.chips.today;
  if (daysUntil === 1) return s.chips.tomorrow;
  return fill(s.chips.due, { date: formatDate(new Date(`${due}T12:00:00`), lang, { day: 'numeric', month: 'short' }) });
}

/** The server's reason for a queue item, as one line of fact. */
function factLine(entry: TodayQueueEntry, s: SpaceTodayStrings, lang: string): string {
  const f = entry.facts;
  const reason = text(f.reason) ?? '';
  const line = (() => {
    switch (reason) {
      case 'overdue':
        return fill(s.fact.overdue, { n: num(f.days_overdue) ?? 1 });
      case 'due_today':
        return s.fact.due_today;
      case 'due_soon':
        return fill(s.fact.due_soon, { date: dueChip(text(f.due_date), num(f.days_until), s, lang).replace(/^[^ ]+ /, '') || (text(f.due_date) ?? '') });
      case 'review_waiting':
        return fill(s.fact.review_waiting, { waited: waited(num(f.waiting_hours), s) });
      case 'issue_idle':
        return fill(s.fact.issue_idle, { n: num(f.idle_days) ?? 0 });
      default:
        return s.fact.priority;
    }
  })();
  const source = text(f.source_priority);
  return source === 'urgent' || source === 'high' ? `${s.fact[source]} · ${line}` : line;
}

/** A queue item's heading: its own title; a pull request's collector already wrote "Review " in front of it, so that is cut. */
function headingOf(entry: TodayQueueEntry): string {
  const name = entry.subject.name ?? '';
  return entry.kind === 'pull_request' ? name.replace(/^review\s+/i, '') : name;
}

/** The same 40px tile the Money cards have: the area's drawing for a task, the source's for a pull request or an issue. */
const QueueMark: React.FC<{ entry: TodayQueueEntry }> = ({ entry }) => {
  const source = text(entry.facts.source);
  const drawing = entry.kind === 'pull_request' || source === 'github' ? 'code' : entry.kind === 'issue' || source === 'linear' ? 'flag' : text(entry.facts.area_id) ? areaIconName(text(entry.facts.area_id)) : 'document';
  return (
    <span aria-hidden="true" className={styles.markTile}>
      <ProjectIcon name={drawing} size={20} />
    </span>
  );
};

const QueueCard: React.FC<{ entry: TodayQueueEntry; strings: SpaceTodayStrings; lang: string; onMarkDone: (id: string) => void; onOpenTab: (tab: TabId) => void }> = ({ entry, strings, lang, onMarkDone, onOpenTab }) => {
  const reason = text(entry.facts.reason) ?? 'priority';
  const act = (code: string | null): TodayAction => {
    const label = strings.actions[code ?? 'open'] ?? strings.actions.open;
    if (code === 'mark_done' && entry.subject.id) {
      const id = entry.subject.id;
      return { label, onClick: () => onMarkDone(id) };
    }
    if (code === 'open_external' && entry.link.url) return { label, href: entry.link.url };
    // Every other action leads to the list the item lives in (nothing is done behind the owner's back).
    return { label, onClick: () => onOpenTab('overview') };
  };
  const severity = reason === 'overdue' || reason === 'review_waiting' ? 'high' : reason === 'issue_idle' ? 'medium' : 'info';
  return <TodayCard item={{ key: entry.key, icon: <QueueMark entry={entry} />, title: headingOf(entry), fact: factLine(entry, strings, lang), primary: act(entry.primary), secondary: act(entry.secondary), severity }} />;
};

const SoonRow: React.FC<{ entry: TodaySoonEntry; strings: SpaceTodayStrings; lang: string; onOpenTab: (tab: TabId) => void }> = ({ entry, strings, lang, onOpenTab }) => {
  const f = entry.facts;
  const chips = entry.kind === 'pull_request' ? [fill(strings.chips.waiting, { waited: waited(num(f.waiting_hours), strings) })] : [dueChip(text(f.due_date), num(f.days_until), strings, lang)];
  const overdue = (num(f.days_overdue) ?? 0) > 0;
  return <TodaySoonRow item={{ key: entry.key, name: entry.subject.name ?? '', chips: overdue ? [strings.chips.overdue, ...chips] : chips.filter(Boolean), action: { label: strings.actions.open, onClick: () => onOpenTab(entry.kind === 'pull_request' ? 'github' : 'overview') }, late: overdue }} />;
};

/** Minutes as "2 h 30 min". */
function minutesLabel(minutes: number, s: SpaceTodayStrings): string {
  if (minutes <= 0) return s.minutes.none;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? fill(s.minutes.short, { m }) : m === 0 ? fill(s.minutes.hours, { h }) : fill(s.minutes.mixed, { h, m });
}

const weekday = (iso: string, lang: string) => formatDate(new Date(`${iso}T12:00:00`), lang, { weekday: 'long' });

function eventTime(event: TodayEvent): string {
  const start = event.startsAt ? splitIso(event.startsAt)?.time : null;
  const end = event.endsAt ? splitIso(event.endsAt)?.time : null;
  return start && end ? `${start}–${end}` : (start ?? '');
}

export interface SpaceTodayProps {
  space: SpaceId;
  data: TodayData | null;
  /** The answer could not be read (and there is none to show). */
  failed: boolean;
  areas: readonly LiveArea[];
  /** The section tabs of the space (the page's own tab list). */
  nav: React.ReactNode;
  /** A task was ticked off here: the page marks it done. */
  onMarkDone: (id: string) => void;
  onOpenTab: (tab: TabId) => void;
  /** The answer is asked again. */
  onReload: () => void;
  /** How many tasks are done (a change in it asks for the answer again). */
  doneCount: number;
}

/**
 * The Today view of Personal, Work 1 and Work 2 on the shared structure, from the server's one answer (`GET /today?scope=`): the answer is codes
 * and facts, and this words them in both languages. Nothing is computed from other lists; "Ask" and the streak are not drawn (the server has
 * none to serve, and Work 2 never shows an Ask box: its data is not sent anywhere).
 */
const SpaceToday: React.FC<SpaceTodayProps> = ({ space, data, failed, areas, nav, onMarkDone, onOpenTab, onReload, doneCount }) => {
  const { t, lang } = useDashboardLang();
  const s = t.spaceToday;
  const { nameOf } = useSpaceNames();
  const [firstDone] = useState(doneCount);
  const reload = useRef(onReload);
  useEffect(() => {
    reload.current = onReload;
  });
  // A task ticked off here or elsewhere changes the queue: ask again a moment later (after the change reached the server).
  useEffect(() => {
    if (doneCount === firstDone) return undefined;
    const timer = setTimeout(() => reload.current(), 500);
    return () => clearTimeout(timer);
  }, [doneCount, firstDone]);

  const summaryFacts = data?.summary.facts ?? {};
  const next = (() => {
    const event = summaryFacts.next_event;
    if (!event || typeof event !== 'object') return '';
    const title = text((event as Record<string, unknown>).title);
    const when = text((event as Record<string, unknown>).starts_at);
    const time = when ? splitIso(when)?.time : null;
    return title && time ? fill(s.summary.next, { title, time }) : '';
  })();
  const open = num(summaryFacts.open) ?? 0;
  const base = !data
    ? ''
    : data.scope === 'work-1'
      ? fill(s.summary.work1, { reviews: num(summaryFacts.review_waiting) ?? 0, progress: num(summaryFacts.issues_in_progress) ?? 0, urgent: num(summaryFacts.urgent) ?? 0 })
      : data.scope === 'work-2'
        ? fill(s.summary.work2, { open, priority: num(summaryFacts.priority) ?? 0 })
        : open === 0
          ? s.summary.empty
          : fill(s.summary.personal, { open, priority: num(summaryFacts.priority) ?? 0, overdue: num(summaryFacts.overdue) ?? 0 });
  const areaName = (id: string, label: { ru: string; en: string } | null) => (label ? label[lang === 'ru' ? 'ru' : 'en'] : (areas.find((area) => area.id === id) ? (lang === 'ru' ? areas.find((area) => area.id === id)?.nameRu : areas.find((area) => area.id === id)?.nameEn) : id) ?? id);

  const queue = data?.queue ?? [];
  const soon = data?.soon ?? [];
  const stats = (data?.stats ?? []).map((stat) => {
    const f = stat.facts;
    const code = stat.code;
    const label = (s.stats as Record<string, string>)[code] ?? code;
    let note = '';
    if (code === 'open_tasks') note = fill(s.stats.open_tasks_note, { priority: num(f.priority) ?? 0, without: num(f.without_date) ?? 0, overdue: num(f.overdue) ?? 0 });
    else if (code === 'closed_this_week') note = stat.compare && stat.compare.value !== null ? fill(s.stats.closed_last_week, { n: stat.compare.value }) : '';
    else if (code === 'review_waiting') note = num(f.oldest_hours) === null ? s.stats.review_none : fill(s.stats.review_waiting_note, { waited: waited(num(f.oldest_hours), s) });
    else if (code === 'issues_in_progress') {
      const by = (f.by_priority && typeof f.by_priority === 'object' ? f.by_priority : {}) as Record<string, unknown>;
      note = fill(s.stats.issues_note, { urgent: num(by.urgent) ?? 0, high: num(by.high) ?? 0 });
    }
    return { key: code, label, value: String(stat.value ?? '—'), note };
  });

  const breakdown = data?.breakdown;
  const meta = breakdown ? (s.breakdown[breakdown.code] ?? { title: breakdown.code, period: '' }) : { title: '', period: '' };
  const largest = Math.max(...(breakdown?.rows.map((row) => row.value) ?? [0]), 0);
  const rows = (breakdown?.rows ?? []).map((row) => {
    const name = breakdown?.code === 'issues_by_stage' ? (s.stage[row.key] ?? s.stage.other) : breakdown?.code === 'meeting_minutes_by_day' ? weekday(row.key, lang) : areaName(row.key, row.label);
    return {
      key: row.key,
      icon: breakdown?.code === 'open_by_area' ? <AreaIcon id={row.key} size={14} /> : undefined,
      name,
      value: breakdown?.code === 'meeting_minutes_by_day' ? minutesLabel(row.value, s) : String(row.value),
      width: largest > 0 ? Math.round((row.value / largest) * 100) : 0,
    };
  });
  let insight: { title: string; text: string } | null = null;
  const found = breakdown?.insight;
  if (found) {
    const f = found.facts;
    if (found.code === 'stale_area') insight = { title: fill(s.insight.stale_area.title, { area: areaName(text(f.area_id) ?? '', null) }), text: fill(s.insight.stale_area.text, { count: num(f.count) ?? 0, days: num(f.older_than_days) ?? 30 }) };
    else if (found.code === 'stalled_pull_requests') insight = { title: s.insight.stalled_pull_requests.title, text: fill(s.insight.stalled_pull_requests.text, { count: num(f.count) ?? 0, days: num(f.oldest_days) ?? 1 }) };
    else if (found.code === 'freest_day' && text(f.date)) {
      const day = weekday(text(f.date) ?? '', lang);
      const minutes = num(f.minutes) ?? 0;
      insight = { title: fill(s.insight.freest_day.title, { day }), text: minutes === 0 ? fill(s.insight.freest_day.textFree, { day }) : fill(s.insight.freest_day.text, { day, minutes: minutesLabel(minutes, s) }) };
    }
  }

  const events = data?.today ?? [];
  const ownerName = text(summaryFacts.owner_name);
  return (
    <TodayLayout
      mark={<SpaceTile space={space} />}
      place={nameOf(space)}
      placeIsHeading
      nav={nav}
      hello={ownerName ? `${s.greeting[partOfDay(new Date().getHours())]}, ${ownerName}` : s.greeting[partOfDay(new Date().getHours())]}
      summary={[base, next].filter(Boolean).join(' ')}
      queue={{
        title: s.queueTitle,
        count: data?.queueTotal ?? 0,
        cards: queue.map((entry) => <QueueCard key={entry.key} entry={entry} strings={s} lang={lang} onMarkDone={onMarkDone} onOpenTab={onOpenTab} />),
        shown: queue.length,
        empty: s.queueEmpty,
        oneAtATime: null,
      }}
      soon={{ title: s.soonTitle, linkLabel: s.soonLink, linkTo: '?tab=overview', rows: soon.map((entry) => <SoonRow key={entry.key} entry={entry} strings={s} lang={lang} onOpenTab={onOpenTab} />), shown: soon.length, empty: s.soonEmpty }}
      stats={stats}
      breakdown={{ title: meta.title, period: meta.period, rows, insight, empty: s.empty }}
      side={
        <>
          {failed && <p role="alert">{s.failed}</p>}
          {/* Ask is drawn only when the server says the assistant exists for this page, and never on Work 2 (its data is not sent anywhere). */}
          {data?.assistantEnabled && space !== 'work-2' && <AskCard scope={space} />}
          <SideCard title={s.todayTitle} linkLabel={s.todayLink} linkTo={pagePath('dashboards-calendar')}>
            {events.length === 0 ? <p>{s.todayEmpty}</p> : events.map((event, index) => <SideRow key={`${event.subject.id ?? index}`} when={eventTime(event)} what={event.facts.busy_only === true ? s.busy : (event.subject.name ?? '')} />)}
          </SideCard>
          {data?.streak && <StreakCard streak={data.streak} today={data.date} />}
        </>
      }
    />
  );
};

export default SpaceToday;
