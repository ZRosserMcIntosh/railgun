import { useState, FormEvent, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input } from '../components/ui';
import { useAuthStore } from '../stores/authStore';
import { initApiClient, getApiClient } from '../lib/api';
import railgunLogo from '../assets/railgun-logo.png';
import RecoveryCodesModal from '../components/RecoveryCodesModal';

export default function RecoverPage() {
  const [username, setUsername] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[] | null>(null);
  const { logout } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    initApiClient(
      () => useAuthStore.getState().accessToken,
      () => logout()
    );
  }, [logout]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      const response = await getApiClient().recoverAccount({
        username,
        recoveryCode,
        newPassword,
      });

      if (response.success) {
        // If new recovery codes were generated, show them
        if (response.recoveryCodes && response.recoveryCodes.length > 0) {
          setNewRecoveryCodes(response.recoveryCodes);
        } else {
          setSuccess(true);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recovery failed');
    } finally {
      setLoading(false);
    }
  };

  const handleNewCodesConfirm = () => {
    setNewRecoveryCodes(null);
    setSuccess(true);
  };

  // Show new recovery codes modal
  if (newRecoveryCodes) {
    return (
      <RecoveryCodesModal
        codes={newRecoveryCodes}
        onConfirm={handleNewCodesConfirm}
        title="New Recovery Codes Generated"
        isRotation={true}
      />
    );
  }

  // Show success message
  if (success) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-tertiary">
        <div className="w-full max-w-md p-8">
          <div className="text-center mb-8">
            <img 
              src={railgunLogo} 
              alt="Rail Gun Logo" 
              className="w-24 h-24 mx-auto mb-4"
            />
          </div>

          <div className="bg-surface-secondary rounded-lg p-6 shadow-xl text-center">
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              Password Reset Successful
            </h2>
            <p className="text-text-secondary mb-6">
              Your password has been changed. You can now log in with your new password.
            </p>
            <Button
              className="w-full"
              size="lg"
              onClick={() => navigate('/login')}
            >
              Go to Login
            </Button>
          </div>
        </div>
      </div>
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
            Account Recovery
          </p>
        </div>

        {/* Recovery Form */}
        <div className="bg-surface-secondary rounded-lg p-6 shadow-xl">
          <h2 className="text-xl font-semibold text-text-primary mb-2 text-center">
            Recover Your Account
          </h2>
          <p className="text-text-muted text-sm text-center mb-6">
            Enter your username and one of your recovery codes to reset your password.
          </p>

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

            <Input
              label="Recovery Code"
              type="text"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX-XXXX"
              required
              className="font-mono"
            />

            <Input
              label="New Password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password (min 8 characters)"
              required
              minLength={8}
            />

            <Input
              label="Confirm New Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
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
              Reset Password
            </Button>
          </form>

          <div className="mt-6 text-center">
            <span className="text-text-muted text-sm">
              Remember your password?{' '}
              <Link
                to="/login"
                className="text-primary-400 hover:text-primary-300 hover:underline"
              >
                Log in
              </Link>
            </span>
          </div>
        </div>

        {/* Warning */}
        <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p className="text-yellow-500 text-xs text-center">
            ⚠️ Each recovery code can only be used once. After recovery, you will receive new codes.
          </p>
        </div>
      </div>
    </div>
  );
}
