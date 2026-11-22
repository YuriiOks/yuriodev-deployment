import { useState } from 'react';
import { useDashboardLang } from '../context/useDashboardLang';
import CalendarToolbar, { type CalendarView } from '../components/dashboards/CalendarToolbar/CalendarToolbar';
import DayStrip from '../components/dashboards/DayStrip/DayStrip';
import MonthGrid from '../components/dashboards/MonthGrid/MonthGrid';
import WeekGrid from '../components/dashboards/WeekGrid/WeekGrid';
import { maxWidth } from '../constants/breakpoints';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useNow } from '../hooks/useNow';
import { usePageTitle } from '../hooks/usePageTitle';
import { useCalendar } from '../hooks/useDashboards';
import { addDays, addMonths, isWeekend, monthMatrix, monthOf, nearestWorkday, stepDay, weekDates } from '../services/dashboards/calendarDates';
import { dateLabel, fill, monthTitle, weekRangeLabel } from '../services/dashboards/calendarLabels';
import { readWorkdaysOnly, writeWorkdaysOnly } from '../services/dashboards/preferences';
import { findConflicts, summarizeHidden } from '../services/dashboards/weekLayout';
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
  const now = useNow();
  const [view, setView] = useState<CalendarView>('week');
  const [workdaysOnly, setWorkdaysOnly] = useState(readWorkdaysOnly);
  const [anchor, setAnchor] = useState(() => (workdaysOnly ? nearestWorkday(calendar.today) : calendar.today));
  // Seven columns do not fit a phone: from the tablet breakpoint up the week, below it one day.
  const phone = useMediaQuery(maxWidth('md'));

  const week = view === 'week';
  const singleDay = week && phone;
  const { year, month } = monthOf(anchor);
  // On a phone with the weekend hidden, the one day on screen is never a Saturday or a Sunday.
  const dayOnScreen = workdaysOnly ? nearestWorkday(anchor) : anchor;
  const dates = singleDay ? [dayOnScreen] : weekDates(anchor, workdaysOnly);
  const shown = new Set(week ? dates : monthMatrix(year, month, workdaysOnly).flat().map((day) => day.date));
  const events = calendar.events.filter((event) => shown.has(event.date));
  const conflicts = findConflicts(events.map((event) => ({ ...event, day: event.date })));
  // The count is of what is marked on screen: blocks in a week, days in a month.
  const marked = week
    ? conflicts.ids.size
    : new Set(events.filter((event) => conflicts.ids.has(event.id)).map((event) => event.date)).size;

  // What the option hides in this range: the weekend days of the week (or of every week of the month).
  const range = week ? weekDates(anchor) : monthMatrix(year, month).flat().map((day) => day.date);
  const hiddenDates = new Set(workdaysOnly ? range.filter(isWeekend) : []);
  const hidden = summarizeHidden(
    calendar.events.map((event) => ({ ...event, day: event.date })),
    hiddenDates,
  );

  // The phone's day strip shows the whole week, whatever single day is on screen.
  const weekEvents = calendar.events.filter((event) => range.includes(event.date));
  const weekConflicts = findConflicts(weekEvents.map((event) => ({ ...event, day: event.date })));

  const chooseWorkdaysOnly = (on: boolean) => {
    setWorkdaysOnly(on);
    writeWorkdaysOnly(on);
    // A weekend day cannot stay on screen on a phone once the weekend is hidden.
    if (on && singleDay) setAnchor(nearestWorkday(anchor));
  };
  const today = () => setAnchor(workdaysOnly ? nearestWorkday(calendar.today) : calendar.today);
  const step = (direction: 1 | -1) =>
    setAnchor(singleDay ? stepDay(dayOnScreen, direction, workdaysOnly) : week ? addDays(anchor, 7 * direction) : addMonths(anchor, direction));
  const pickDay = (date: string) => {
    setAnchor(date);
    setView('week');
  };
  const period = singleDay ? dateLabel(dayOnScreen, t) : week ? weekRangeLabel(anchor, t) : monthTitle(anchor, t);

  return (
    <>
      <CalendarToolbar
        period={period}
        conflicts={marked}
        view={view}
        day={singleDay}
        onView={setView}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onToday={today}
        workdaysOnly={workdaysOnly}
        onWorkdaysOnly={chooseWorkdaysOnly}
      />
      {singleDay && (
        <DayStrip
          dates={weekDates(anchor, workdaysOnly)}
          selected={dayOnScreen}
          today={calendar.today}
          events={weekEvents}
          conflicts={weekConflicts}
          onPick={setAnchor}
        />
      )}
      {week ? (
        <WeekGrid dates={dates} today={calendar.today} hours={calendar.hours} events={events} conflicts={conflicts} now={now} />
      ) : (
        <MonthGrid year={year} month={month} today={calendar.today} events={events} conflicts={conflicts} onPickDay={pickDay} workdaysOnly={workdaysOnly} />
      )}
      {hidden.count > 0 && (
        <p className={styles.hidden} role="status">
          {fill(t.weekendHidden, { n: hidden.count })}
          {hidden.conflict && ` ${t.weekendHiddenConflict}`}
          <button type="button" className={styles.show} onClick={() => chooseWorkdaysOnly(false)}>
            {t.showWeekend}
          </button>
        </p>
      )}
    </>
  );
};

export default DashboardsCalendar;
