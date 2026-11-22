import { useDashboardLang } from '../context/useDashboardLang';
import CalendarToolbar from '../components/dashboards/CalendarToolbar/CalendarToolbar';
import DashboardHeading from '../components/dashboards/DashboardHeading/DashboardHeading';
import WeekGrid from '../components/dashboards/WeekGrid/WeekGrid';
import { usePageTitle } from '../hooks/usePageTitle';
import { useWeek } from '../hooks/useDashboards';
import { pageLabel } from '../data/site';
import styles from './dashboards-calendar.module.css';

/** /dashboards/calendar: the one page where all three spaces share a grid. Events only, no tasks. */
const DashboardsCalendar = () => {
  usePageTitle(pageLabel('dashboards-calendar'));
  const { t, text } = useDashboardLang();
  const week = useWeek();

  return (
    <>
      <DashboardHeading id="calendar-title" title={t.calendarTitle} aside={text(week.range)} lead={t.calendarLead}>
        <CalendarToolbar />
      </DashboardHeading>
      <WeekGrid week={week} />
      <p className={styles.note}>{t.calendarNote}</p>
    </>
  );
};

export default DashboardsCalendar;
