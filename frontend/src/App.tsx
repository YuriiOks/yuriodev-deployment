import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
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
import './App.css';

/** sessionStorage flag: the first-visit loading screen has already been shown in this tab. */
const LOADER_SHOWN_KEY = 'appLoaded';

function AppContent() {
  const location = useLocation();
  const [showLoader, setShowLoader] = useState(() => readStorage('session', LOADER_SHOWN_KEY) !== 'true');

  // No page scrolling while the loading screen covers the page.
  useEffect(() => {
    if (!showLoader) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [showLoader]);

  const handleLoadingComplete = () => {
    writeStorage('session', LOADER_SHOWN_KEY, 'true');
    setShowLoader(false);
  };

  // Show ONLY loading screen without any layout wrapper
  if (showLoader) {
    return <LoadingScreen onComplete={handleLoadingComplete} />;
  }

  return (
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
