import { useState } from 'react';
import { useDashboardLang } from '../context/useDashboardLang';
import CalendarToolbar, { type CalendarView } from '../components/dashboards/CalendarToolbar/CalendarToolbar';
import DashboardHeading from '../components/dashboards/DashboardHeading/DashboardHeading';
import MonthGrid from '../components/dashboards/MonthGrid/MonthGrid';
import WeekGrid from '../components/dashboards/WeekGrid/WeekGrid';
import { maxWidth } from '../constants/breakpoints';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { usePageTitle } from '../hooks/usePageTitle';
import { useCalendar } from '../hooks/useDashboards';
import { addDays, addMonths, monthMatrix, monthOf, weekDates } from '../services/dashboards/calendarDates';
import { dateLabel, monthTitle, weekRangeLabel } from '../services/dashboards/calendarLabels';
import { findConflicts } from '../services/dashboards/weekLayout';
import styles from './dashboards-calendar.module.css';

/**
 * /dashboards/calendar: the one page where all three spaces share a grid.
 * Events only, no tasks. A week (days by hours, events placed by time; on a
 * phone one day at a time) or a month (a day each, a few chips); picking a
 * day in the month opens its week. `anchor` is any date inside what is on
 * screen.
 */
const DashboardsCalendar = () => {
  const { t } = useDashboardLang();
  usePageTitle(t.titles.calendar);
  const calendar = useCalendar();
  const [view, setView] = useState<CalendarView>('week');
  const [anchor, setAnchor] = useState(calendar.today);
  // Seven columns do not fit a phone: from the tablet breakpoint up the week, below it one day.
  const phone = useMediaQuery(maxWidth('md'));

  const week = view === 'week';
  const singleDay = week && phone;
  const { year, month } = monthOf(anchor);
  const dates = singleDay ? [anchor] : weekDates(anchor);
  const shown = new Set(week ? dates : monthMatrix(year, month).flat().map((day) => day.date));
  const events = calendar.events.filter((event) => shown.has(event.date));
  const conflicts = findConflicts(events.map((event) => ({ ...event, day: event.date })));
  // The count is of what is marked on screen: blocks in a week, days in a month.
  const marked = week
    ? conflicts.ids.size
    : new Set(events.filter((event) => conflicts.ids.has(event.id)).map((event) => event.date)).size;

  const step = (direction: 1 | -1) =>
    setAnchor(singleDay ? addDays(anchor, direction) : week ? addDays(anchor, 7 * direction) : addMonths(anchor, direction));
  const pickDay = (date: string) => {
    setAnchor(date);
    setView('week');
  };
  const period = singleDay ? dateLabel(anchor, t) : week ? weekRangeLabel(anchor, t) : monthTitle(anchor, t);

  return (
    <>
      <DashboardHeading id="calendar-title" title={t.calendarTitle} aside={period} lead={t.calendarLead}>
        <CalendarToolbar
          conflicts={marked}
          view={view}
          day={singleDay}
          onView={setView}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onToday={() => setAnchor(calendar.today)}
        />
      </DashboardHeading>
      {week ? (
        <WeekGrid dates={dates} today={calendar.today} hours={calendar.hours} events={events} conflicts={conflicts} />
      ) : (
        <MonthGrid year={year} month={month} today={calendar.today} events={events} conflicts={conflicts} onPickDay={pickDay} />
      )}
      <p className={styles.note}>{t.calendarNote}</p>
    </>
  );
};

export default DashboardsCalendar;
