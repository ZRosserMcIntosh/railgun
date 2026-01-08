import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initScreenshotProtection } from './lib/screenshotProtection';

// Initialize error tracking (privacy-respecting, respects user preference)
try {
  const crashReportingEnabled = localStorage.getItem('crashReportingEnabled') !== 'false';
  import('./lib/sentry').then(({ initSentry }) => {
    initSentry({ enabled: crashReportingEnabled });
  }).catch((e) => {
    console.warn('[Sentry] Failed to initialize:', e);
  });
} catch (e) {
  console.warn('[Sentry] Failed to initialize:', e);
}

// Initialize screenshot protection
try {
  initScreenshotProtection();
} catch (e) {
  console.warn('[Screenshot Protection] Failed to initialize:', e);
}

// Simple error boundary for initial render
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[RootErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          height: '100vh', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          flexDirection: 'column',
          background: '#1a1a2e',
          color: '#fff',
          fontFamily: 'system-ui, sans-serif'
        }}>
          <h1 style={{ marginBottom: '1rem' }}>Something went wrong</h1>
          <p style={{ color: '#888', marginBottom: '1rem' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1rem',
              background: '#4f46e5',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer'
            }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </RootErrorBoundary>
  </React.StrictMode>
);
