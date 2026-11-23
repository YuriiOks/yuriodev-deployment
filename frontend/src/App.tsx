import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import PageLayout from './components/layout/PageLayout/PageLayout';
import LoadingScreen from './components/ui/LoadingScreen/LoadingScreen';
import ErrorBoundary from './components/ui/ErrorBoundary/ErrorBoundary';
import Portfolio from './pages/portfolio';
import Community from './pages/community';
import Courses from './pages/courses';
import Dashboard from './pages/dashboard';
import Privacy from './pages/privacy';
import NotFound from './pages/not-found';
import DashboardShell from './components/dashboards/DashboardShell/DashboardShell';
import Dashboards from './pages/dashboards';
import DashboardSpace from './pages/dashboard-space';
import DashboardsCalendar from './pages/dashboards-calendar';
import DashboardProject from './pages/dashboard-project';
import { readStorage, writeStorage } from './utils/safeStorage';
import { prefersReducedMotion } from './utils/motion';
import { PROJECTS_PATH, pagePath } from './data/site';
import './App.css';

/** sessionStorage flag: the first-visit loading screen has already been shown in this tab. */
const LOADER_SHOWN_KEY = 'appLoaded';

function AppContent() {
  const location = useLocation();
  // Once per tab session, and never for visitors who ask for reduced motion.
  const [showLoader, setShowLoader] = useState(
    () => !prefersReducedMotion() && readStorage('session', LOADER_SHOWN_KEY) !== 'true',
  );

  // No page scrolling while the loading screen covers the page.
  useEffect(() => {
    if (!showLoader) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [showLoader]);

  const handleLoadingComplete = useCallback(() => {
    writeStorage('session', LOADER_SHOWN_KEY, 'true');
    setShowLoader(false);
  }, []);

  // The page renders underneath the intro from the start, so it is ready
  // (and its content already painted) the moment the intro ends.
  return (
    <>
      {showLoader && <LoadingScreen onComplete={handleLoadingComplete} />}
      <PageLayout currentPath={location.pathname}>
        <ErrorBoundary resetKey={location.pathname}>
          <Routes>
            <Route path={pagePath('portfolio')} element={<Portfolio />} />
            <Route path="/home" element={<Navigate to={pagePath('portfolio')} replace />} />
            <Route path={pagePath('community')} element={<Community />} />
            <Route path={pagePath('courses')} element={<Courses />} />
            <Route path={pagePath('dashboard')} element={<Dashboard />} />
            <Route path={pagePath('privacy')} element={<Privacy />} />
            {/* Private: not in the header, palette, footer or terminal. The layout route holds the bar and the language; its children use full paths. */}
            <Route path={pagePath('dashboards')} element={<DashboardShell />}>
              <Route index element={<Dashboards />} />
              <Route path={pagePath('dashboards-personal')} element={<DashboardSpace key="personal" space="personal" />} />
              <Route path={pagePath('dashboards-work-1')} element={<DashboardSpace key="work-1" space="work-1" />} />
              <Route path={pagePath('dashboards-work-2')} element={<DashboardSpace key="work-2" space="work-2" />} />
              <Route path={pagePath('dashboards-calendar')} element={<DashboardsCalendar />} />
              <Route path={`${PROJECTS_PATH}/:id`} element={<DashboardProject />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ErrorBoundary>
      </PageLayout>
    </>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App
