import { useState, FormEvent, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input } from '../components/ui';
import { useAuthStore } from '../stores/authStore';
import { initApiClient, getApiClient } from '../lib/api';
import railgunLogo from '../assets/railgun-logo.png';
import RecoveryCodesModal from '../components/RecoveryCodesModal';

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [pendingUser, setPendingUser] = useState<{
    id: string;
    username: string;
    displayName: string;
    accessToken: string;
    refreshToken: string;
  } | null>(null);
  const { login, logout } = useAuthStore();

  useEffect(() => {
    initApiClient(
      () => useAuthStore.getState().accessToken,
      () => logout()
    );
  }, [logout]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      const response = await getApiClient().register({
        username,
        password,
      });
      
      // Store user data and show recovery codes
      setPendingUser({
        id: response.user.id,
        username: response.user.username,
        displayName: response.user.displayName,
        accessToken: response.tokens.accessToken,
        refreshToken: response.tokens.refreshToken,
      });
      setRecoveryCodes(response.recoveryCodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRecoveryCodesConfirm = async () => {
    if (pendingUser) {
      await login(
        {
          id: pendingUser.id,
          username: pendingUser.username,
          displayName: pendingUser.displayName,
        },
        pendingUser.accessToken,
        pendingUser.refreshToken
      );
    }
    setRecoveryCodes(null);
    setPendingUser(null);
  };

  // Show recovery codes modal after successful registration
  if (recoveryCodes && pendingUser) {
    return (
      <RecoveryCodesModal
        codes={recoveryCodes}
        onConfirm={handleRecoveryCodesConfirm}
        title="Welcome to Rail Gun!"
      />
    );
  }

  return (
    <div className="h-full flex items-center justify-center bg-surface-tertiary">
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
            Create your secure account
          </p>
        </div>

        {/* Register Form */}
        <div className="bg-surface-secondary rounded-lg p-6 shadow-xl">
          <h2 className="text-xl font-semibold text-text-primary mb-6 text-center">
            Create an account
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              required
              autoFocus
            />

            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password (min 8 characters)"
              required
              minLength={8}
            />

            <Input
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              required
            />

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
              Create Account
            </Button>
          </form>

          <div className="mt-6 text-center">
            <span className="text-text-muted text-sm">
              Already have an account?{' '}
              <Link
                to="/login"
                className="text-primary-400 hover:text-primary-300 hover:underline"
              >
                Log in
              </Link>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
