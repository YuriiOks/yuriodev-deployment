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
import { readStorage, writeStorage } from './utils/safeStorage';
import { prefersReducedMotion } from './utils/motion';
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
            <Route path="/" element={<Portfolio />} />
            <Route path="/home" element={<Navigate to="/" replace />} />
            <Route path="/community" element={<Community />} />
            <Route path="/courses" element={<Courses />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/privacy" element={<Privacy />} />
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
