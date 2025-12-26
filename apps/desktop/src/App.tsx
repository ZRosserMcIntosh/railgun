import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import RecoverPage from './pages/RecoverPage';
import { DownloadsPage } from './pages/DownloadsPage';
import MainLayout from './layouts/MainLayout';

function App() {
  const { isAuthenticated, isInitialized, initialize } = useAuthStore();

  // Initialize auth store on app startup (load tokens from secure storage)
  useEffect(() => {
    if (!isInitialized) {
      initialize();
    }
  }, [isInitialized, initialize]);

  // Show loading state while initializing
  if (!isInitialized) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-surface-tertiary">
        <div className="text-text-muted">Loading...</div>
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
