import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import RecoverPage from './pages/RecoverPage';
import { DownloadsPage } from './pages/DownloadsPage';
import MainLayout from './layouts/MainLayout';
import { appLogger } from './lib/logger';

function App() {
  const { isAuthenticated, isInitialized, initialize } = useAuthStore();

  // Initialize auth store on app startup (load tokens from secure storage)
  useEffect(() => {
    appLogger.debug('useEffect running, isInitialized:', isInitialized);
    if (!isInitialized) {
      appLogger.debug('Calling initialize()...');
      initialize().then(() => {
        appLogger.debug('initialize() completed');
      }).catch((error) => {
        appLogger.error('initialize() failed:', error);
      });
    }
  }, [isInitialized, initialize]);

  // Add a timeout fallback to handle stuck initialization
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!isInitialized) {
        appLogger.warn('Initialization timeout - forcing to login');
        // Force show login after 5 seconds if still not initialized
        useAuthStore.setState({ isInitialized: true, isAuthenticated: false });
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }, [isInitialized]);

  // Show loading state while initializing
  if (!isInitialized) {
    appLogger.debug('Rendering loading state');
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-surface-tertiary">
        <div className="text-white text-xl">Loading Railgun...</div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-surface-tertiary">
      <Routes>
        {/* Public routes - accessible without authentication */}
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route
          path="/register"
          element={isAuthenticated ? <Navigate to="/" replace /> : <RegisterPage />}
        />
        <Route
          path="/recover"
          element={isAuthenticated ? <Navigate to="/" replace /> : <RecoverPage />}
        />
        <Route
          path="/*"
          element={isAuthenticated ? <MainLayout /> : <Navigate to="/login" replace />}
        />
        <Route path="/downloads" element={<DownloadsPage />} />
      </Routes>
    </div>
  );
}

export default App;
