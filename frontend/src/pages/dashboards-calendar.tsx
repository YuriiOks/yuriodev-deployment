import { useState } from 'react';
import { useDashboardLang } from '../context/useDashboardLang';
import CalendarToolbar, { type CalendarView } from '../components/dashboards/CalendarToolbar/CalendarToolbar';
import DashboardHeading from '../components/dashboards/DashboardHeading/DashboardHeading';
import MonthGrid from '../components/dashboards/MonthGrid/MonthGrid';
import WeekGrid from '../components/dashboards/WeekGrid/WeekGrid';
import { usePageTitle } from '../hooks/usePageTitle';
import { useCalendar } from '../hooks/useDashboards';
import { pageLabel } from '../data/site';
import { addDays, addMonths, monthMatrix, monthOf, weekDates } from '../services/dashboards/calendarDates';
import { monthTitle, weekRangeLabel } from '../services/dashboards/calendarLabels';
import { findConflicts } from '../services/dashboards/weekLayout';
import styles from './dashboards-calendar.module.css';

/**
 * /dashboards/calendar: the one page where all three spaces share a grid.
 * Events only, no tasks. A week (days by hours, events placed by time) or a
 * month (a day each, a few chips); picking a day in the month opens its week.
 * `anchor` is any date inside what is on screen.
 */
const DashboardsCalendar = () => {
  usePageTitle(pageLabel('dashboards-calendar'));
  const { t } = useDashboardLang();
  const calendar = useCalendar();
  const [view, setView] = useState<CalendarView>('week');
  const [anchor, setAnchor] = useState(calendar.today);

  const week = view === 'week';
  const { year, month } = monthOf(anchor);
  const dates = weekDates(anchor);
  const shown = new Set(week ? dates : monthMatrix(year, month).flat().map((day) => day.date));
  const events = calendar.events.filter((event) => shown.has(event.date));
  const conflicts = findConflicts(events.map((event) => ({ ...event, day: event.date })));

  const step = (direction: 1 | -1) => setAnchor(week ? addDays(anchor, 7 * direction) : addMonths(anchor, direction));
  const pickDay = (date: string) => {
    setAnchor(date);
    setView('week');
  };

  return (
    <>
      <DashboardHeading
        id="calendar-title"
        title={t.calendarTitle}
        aside={week ? weekRangeLabel(anchor, t) : monthTitle(anchor, t)}
        lead={t.calendarLead}
      >
        <CalendarToolbar
          conflicts={conflicts.count}
          view={view}
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
