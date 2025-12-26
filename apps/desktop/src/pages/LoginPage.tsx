import { useState, FormEvent, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input } from '../components/ui';
import { useAuthStore } from '../stores/authStore';
import { initApiClient, getApiClient } from '../lib/api';
import railgunLogo from '../assets/railgun-logo.png';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, logout } = useAuthStore();

  useEffect(() => {
    // Initialize API client
    initApiClient(
      () => useAuthStore.getState().accessToken,
      () => logout()
    );
  }, [logout]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await getApiClient().login({ username, password });
      await login(
        {
          id: response.user.id,
          username: response.user.username,
          displayName: response.user.displayName,
        },
        response.tokens.accessToken,
        response.tokens.refreshToken
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface-tertiary">
      {/* Header with Download CTA */}
      <header className="flex-shrink-0 px-6 py-3 flex items-center justify-end border-b border-dark-800">
        <Link
          to="/downloads"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-400 hover:text-primary-300 hover:bg-surface-elevated rounded-md transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Get Rail Gun
        </Link>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-md p-8">
        {/* Logo */}
        <div className="text-center mb-8">
          <img 
            src={railgunLogo} 
            alt="Rail Gun Logo" 
            className="w-24 h-24 mx-auto mb-4"
          />
          <h1 className="text-3xl font-bold text-text-primary mb-2">
            Rail Gun
          </h1>
          <p className="text-text-secondary">
            Secure, end-to-end encrypted messaging
          </p>
        </div>

        {/* Login Form */}
        <div className="bg-surface-secondary rounded-lg p-6 shadow-xl">
          <h2 className="text-xl font-semibold text-text-primary mb-6 text-center">
            Welcome back!
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              required
              autoFocus
            />

            <div>
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
              <div className="mt-1 text-right">
                <Link
                  to="/recover"
                  className="text-xs text-text-muted hover:text-primary-400"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-red-500">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={loading}
            >
              Log In
            </Button>
          </form>

          <div className="mt-6 text-center">
            <span className="text-text-muted text-sm">
              Need an account?{' '}
              <Link
                to="/register"
                className="text-primary-400 hover:text-primary-300 hover:underline"
              >
                Register
              </Link>
            </span>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-text-muted text-xs mt-8">
          Your messages are end-to-end encrypted.
          <br />
          Not even we can read them.
        </p>
      </div>
      </div>

      {/* Bottom Footer with Download CTA */}
      <footer className="flex-shrink-0 px-6 py-4 border-t border-dark-800 text-center">
        <Link
          to="/downloads"
          className="text-sm text-text-muted hover:text-text-primary"
        >
          Download Rail Gun for Windows, macOS, or Linux →
        </Link>
      </footer>
    </div>
  );
}
