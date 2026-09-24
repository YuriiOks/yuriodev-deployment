import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import PageLayout from './components/layout/PageLayout/PageLayout';
import LoadingScreen from './components/ui/LoadingScreen/LoadingScreen';
import Portfolio from './pages/portfolio';
import Community from './pages/community';
import Courses from './pages/courses';
import Dashboard from './pages/dashboard';
import './App.css';

function AppContent() {
  const location = useLocation();
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [loadingComplete, setLoadingComplete] = useState(false);

  useEffect(() => {
    // Check if app has been loaded before in this session
    const hasLoaded = sessionStorage.getItem('appLoaded');
    
    if (hasLoaded === 'true') {
      // Skip loading screen if already shown this session
      setIsInitialLoad(false);
      setLoadingComplete(true);
      document.body.style.overflow = ''; // Ensure scroll is enabled
    } else {
      // First visit this session - show loading screen
      setIsInitialLoad(true);
      setLoadingComplete(false);
      document.body.style.overflow = 'hidden'; // Prevent scrolling during load
    }
  }, []);

  const handleLoadingComplete = () => {
    // Mark as loaded in sessionStorage
    sessionStorage.setItem('appLoaded', 'true');
    setLoadingComplete(true);
    setIsInitialLoad(false);
    
    // Re-enable scrolling
    document.body.style.overflow = '';
    
    // Console message
    console.log('%c$ ./initialize_yuriodev --status=complete', 'color: #FFC107; font-family: "Fira Code", monospace; font-weight: 600;');
    console.log('%c✓ Portfolio loaded successfully', 'color: #00ff88; font-family: "Fira Code", monospace;');
  };

  // Show ONLY loading screen without any layout wrapper
  if (isInitialLoad && !loadingComplete) {
    return <LoadingScreen onComplete={handleLoadingComplete} />;
  }
  
  return (
    <PageLayout currentPath={location.pathname}>
      <Routes>
        <Route path="/" element={<Portfolio />} />
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="/community" element={<Community />} />
        <Route path="/courses" element={<Courses />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
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
