import { useState, FormEvent, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input } from '../components/ui';
import { useAuthStore } from '../stores/authStore';
import { initApiClient, getApiClient } from '../lib/api';
import railgunLogo from '../assets/railgun-logo.png';
import RecoveryCodesModal from '../components/RecoveryCodesModal';

type RecoveryMethod = 'code' | 'email';

export default function RecoverPage() {
  const [recoveryMethod, setRecoveryMethod] = useState<RecoveryMethod>('code');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
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

    if (recoveryMethod === 'email') {
      // Email-based recovery - send reset link
      if (!email.trim()) {
        setError('Please enter your email address');
        return;
      }

      setLoading(true);

      try {
        await getApiClient().requestPasswordReset({ email: email.trim() });
        setEmailSent(true);
      } catch (err) {
        // Don't reveal if email exists or not for privacy
        setEmailSent(true); // Show success anyway
      } finally {
        setLoading(false);
      }
      return;
    }

    // Code-based recovery
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
            Choose a recovery method to reset your password.
          </p>

          {/* Recovery Method Toggle */}
          <div className="flex rounded-lg bg-surface-tertiary p-1 mb-6">
            <button
              type="button"
              onClick={() => {
                setRecoveryMethod('code');
                setError('');
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                recoveryMethod === 'code'
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Recovery Code
            </button>
            <button
              type="button"
              onClick={() => {
                setRecoveryMethod('email');
                setError('');
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                recoveryMethod === 'email'
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Email Recovery
            </button>
          </div>

          {/* Email Sent Confirmation */}
          {emailSent && recoveryMethod === 'email' && (
            <div className="p-4 mb-4 rounded-md bg-green-500/10 border border-green-500/30">
              <div className="flex gap-2">
                <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-green-500">Recovery email sent!</p>
                  <p className="text-xs text-green-500/80 mt-1">
                    Check your inbox for a link to reset your password. The link expires in 1 hour.
                  </p>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {recoveryMethod === 'code' ? (
              <>
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
              </>
            ) : (
              <>
                <Input
                  label="Email Address"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter the email linked to your account"
                  required
                  autoFocus
                />

                {/* Email Recovery Privacy Notice */}
                <div className="p-3 rounded-md bg-surface-tertiary border border-surface-tertiary">
                  <p className="text-xs text-text-muted">
                    <span className="font-medium text-text-secondary">Note:</span> This only works if you added an email during registration. 
                    If you didn't add an email, use a recovery code instead.
                  </p>
                </div>
              </>
            )}

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
              disabled={emailSent && recoveryMethod === 'email'}
            >
              {recoveryMethod === 'email' 
                ? (emailSent ? 'Email Sent' : 'Send Recovery Link')
                : 'Reset Password'
              }
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

        {/* Warning - only show for recovery code method */}
        {recoveryMethod === 'code' && (
          <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <p className="text-yellow-500 text-xs text-center">
              ⚠️ Each recovery code can only be used once. After recovery, you will receive new codes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
