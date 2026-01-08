/**
 * Key Backup & Export Component
 * 
 * Week 5-6 Client Polish: Secure key export and import functionality
 * 
 * DOCTRINE COMPLIANCE:
 * - Principle 3: User Keys, User Data - Full user control over keys
 * - Principle 10: Exit Rights - Users can export and leave anytime
 * 
 * SECURITY:
 * - Keys encrypted with user-provided passphrase before export
 * - Uses AES-256-GCM for encryption
 * - Warns about security implications
 */

import { useState, useCallback } from 'react';
import { Button, Input } from './ui';

interface KeyBackupProps {
  onClose: () => void;
}

type BackupMode = 'export' | 'import';

export default function KeyBackup({ onClose }: KeyBackupProps) {
  const [mode, setMode] = useState<BackupMode>('export');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [importData, setImportData] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleExport = useCallback(async () => {
    setError('');
    setSuccess('');

    if (passphrase.length < 12) {
      setError('Passphrase must be at least 12 characters');
      return;
    }

    if (passphrase !== confirmPassphrase) {
      setError('Passphrases do not match');
      return;
    }

    setLoading(true);

    try {
      // Get keys from secure storage
      const keys = await getLocalKeys();
      
      // Encrypt keys with passphrase
      const encryptedBundle = await encryptKeyBundle(keys, passphrase);
      
      // Create downloadable file
      const blob = new Blob([JSON.stringify(encryptedBundle, null, 2)], { 
        type: 'application/json' 
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `railgun-keys-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess('Keys exported successfully! Store this file securely.');
      setPassphrase('');
      setConfirmPassphrase('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  }, [passphrase, confirmPassphrase]);

  const handleImport = useCallback(async () => {
    setError('');
    setSuccess('');

    if (!importData.trim()) {
      setError('Please paste your key backup data');
      return;
    }

    if (!passphrase) {
      setError('Please enter the passphrase used during export');
      return;
    }

    setLoading(true);

    try {
      // Parse the backup data
      const encryptedBundle = JSON.parse(importData);
      
      // Decrypt keys with passphrase
      const keys = await decryptKeyBundle(encryptedBundle, passphrase);
      
      // Store keys in secure storage
      await storeLocalKeys(keys);

      setSuccess('Keys imported successfully! You may need to restart the app.');
      setImportData('');
      setPassphrase('');
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Invalid backup data format');
      } else {
        setError('Decryption failed - check your passphrase');
      }
    } finally {
      setLoading(false);
    }
  }, [importData, passphrase]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface-secondary rounded-xl shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-tertiary">
          <h2 className="text-lg font-semibold text-text-primary">
            Key Backup & Restore
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-tertiary transition-colors"
          >
            <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="p-4 border-b border-surface-tertiary">
          <div className="flex rounded-lg bg-surface-tertiary p-1">
            <button
              onClick={() => {
                setMode('export');
                setError('');
                setSuccess('');
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                mode === 'export'
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Export Keys
            </button>
            <button
              onClick={() => {
                setMode('import');
                setError('');
                setSuccess('');
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                mode === 'import'
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Import Keys
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {mode === 'export' ? (
            <>
              {/* Export Warning */}
              <div className="p-3 rounded-md bg-yellow-500/10 border border-yellow-500/30">
                <div className="flex gap-2">
                  <svg className="w-5 h-5 text-yellow-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-yellow-500">Security Warning</p>
                    <p className="text-xs text-yellow-500/80 mt-1">
                      Your exported keys will be encrypted with your passphrase. 
                      Anyone with the file AND passphrase can access your account.
                      Store both securely and separately.
                    </p>
                  </div>
                </div>
              </div>

              <Input
                label="Encryption Passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Create a strong passphrase (min 12 chars)"
                minLength={12}
              />

              <Input
                label="Confirm Passphrase"
                type="password"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                placeholder="Confirm your passphrase"
              />

              {/* Passphrase Strength */}
              <PassphraseStrength passphrase={passphrase} />
            </>
          ) : (
            <>
              {/* Import Info */}
              <div className="p-3 rounded-md bg-surface-tertiary">
                <p className="text-sm text-text-secondary">
                  Paste the contents of your key backup file below, then enter the 
                  passphrase you used when exporting.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Key Backup Data
                </label>
                <textarea
                  value={importData}
                  onChange={(e) => setImportData(e.target.value)}
                  placeholder='{"version": 1, "encrypted": "...", ...}'
                  className="w-full h-32 px-3 py-2 rounded-md bg-surface-tertiary border border-surface-tertiary text-text-primary text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <Input
                label="Decryption Passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter the passphrase from export"
              />
            </>
          )}

          {/* Error/Success Messages */}
          {error && (
            <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-500">{error}</p>
            </div>
          )}

          {success && (
            <div className="p-3 rounded-md bg-green-500/10 border border-green-500/20">
              <p className="text-sm text-green-500">{success}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-surface-tertiary flex gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={mode === 'export' ? handleExport : handleImport}
            loading={loading}
            disabled={mode === 'export' 
              ? passphrase.length < 12 || passphrase !== confirmPassphrase
              : !importData.trim() || !passphrase
            }
          >
            {mode === 'export' ? 'Export Keys' : 'Import Keys'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function PassphraseStrength({ passphrase }: { passphrase: string }) {
  const getStrength = (pass: string): { score: number; label: string; color: string } => {
    let score = 0;
    
    if (pass.length >= 12) score += 1;
    if (pass.length >= 16) score += 1;
    if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^a-zA-Z0-9]/.test(pass)) score += 1;
    
    if (score <= 1) return { score, label: 'Weak', color: 'bg-red-500' };
    if (score <= 2) return { score, label: 'Fair', color: 'bg-yellow-500' };
    if (score <= 3) return { score, label: 'Good', color: 'bg-blue-500' };
    return { score, label: 'Strong', color: 'bg-green-500' };
  };

  const strength = getStrength(passphrase);
  
  if (!passphrase) return null;

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i <= strength.score ? strength.color : 'bg-surface-tertiary'
            }`}
          />
        ))}
      </div>
      <p className={`text-xs ${strength.color.replace('bg-', 'text-')}`}>
        {strength.label}
      </p>
    </div>
  );
}

// ============================================================================
// Crypto Functions
// ============================================================================

interface KeyBundle {
  identityKey: string;
  signedPreKey: string;
  preKeys: string[];
  deviceId: string;
}

interface EncryptedKeyBundle {
  version: number;
  encrypted: string;
  iv: string;
  salt: string;
  iterations: number;
}

async function getLocalKeys(): Promise<KeyBundle> {
  // In production, this would read from secure storage
  // For now, we'll use a placeholder that indicates the actual implementation location
  const stored = localStorage.getItem('railgun_device_keys');
  if (stored) {
    return JSON.parse(stored);
  }
  
  // Return placeholder for demo - actual keys would come from IndexedDB/Keychain
  return {
    identityKey: 'placeholder-identity-key',
    signedPreKey: 'placeholder-signed-pre-key',
    preKeys: ['placeholder-pre-key-1', 'placeholder-pre-key-2'],
    deviceId: 'placeholder-device-id',
  };
}

async function storeLocalKeys(keys: KeyBundle): Promise<void> {
  // In production, this would write to secure storage
  localStorage.setItem('railgun_device_keys', JSON.stringify(keys));
}

async function encryptKeyBundle(keys: KeyBundle, passphrase: string): Promise<EncryptedKeyBundle> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(keys));
  
  // Generate salt and derive key
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iterations = 100000;
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  
  // Encrypt
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  
  return {
    version: 1,
    encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
    salt: btoa(String.fromCharCode(...salt)),
    iterations,
  };
}

async function decryptKeyBundle(bundle: EncryptedKeyBundle, passphrase: string): Promise<KeyBundle> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  
  // Decode base64
  const encrypted = Uint8Array.from(atob(bundle.encrypted), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(bundle.iv), c => c.charCodeAt(0));
  const salt = Uint8Array.from(atob(bundle.salt), c => c.charCodeAt(0));
  
  // Derive key
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: bundle.iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  
  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );
  
  return JSON.parse(decoder.decode(decrypted));
}
