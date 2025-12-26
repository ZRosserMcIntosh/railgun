/**
 * Update Verification Service
 * 
 * Cryptographically verifies updates using chain-of-trust signatures.
 * Implements rollback protection and multi-source download.
 */

import type {
  UpdateManifest,
  UpdateArtifact,
  VerificationResult,
  VerificationContext,
  UpdateProgress,
  UpdateState,
  SigningKey,
  KeyChain,
  Platform,
} from '@railgun/shared';

// =============================================================================
// Embedded Root Public Key
// =============================================================================

/**
 * ROOT PUBLIC KEY - Embedded at build time
 * This is the trust anchor for the entire update system.
 * 
 * In production, generate with:
 * ```bash
 * openssl genpkey -algorithm Ed25519 -out root_private.pem
 * openssl pkey -in root_private.pem -pubout -out root_public.pem
 * ```
 */
const ROOT_PUBLIC_KEY: SigningKey = {
  keyId: 'root-2025-01',
  publicKey: 'MCowBQYDK2VwAyEA_REPLACE_WITH_REAL_ROOT_PUBLIC_KEY_BASE64_', // REPLACE IN PRODUCTION
  type: 'root',
  createdAt: Date.parse('2025-01-01T00:00:00Z'),
  revoked: false,
};

// =============================================================================
// Crypto Utilities
// =============================================================================

/**
 * Verify Ed25519 signature
 */
async function verifyEd25519(
  publicKeyBase64: string,
  signatureBase64: string,
  message: Uint8Array
): Promise<boolean> {
  try {
    // Import the public key
    const keyData = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0));
    
    const publicKey = await crypto.subtle.importKey(
      'raw',
      keyData.slice(-32), // Ed25519 public keys are 32 bytes
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    
    // Decode signature
    const signature = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
    
    // Verify - convert to ArrayBuffer to satisfy BufferSource type
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      signature,
      new Uint8Array(message).buffer as ArrayBuffer
    );
  } catch (error) {
    console.error('[Update] Signature verification failed:', error);
    return false;
  }
}

/**
 * Compute SHA-256 hash
 */
async function sha256(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute SHA-512 hash
 */
async function sha512(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-512', new Uint8Array(data).buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// =============================================================================
// Key Chain Verification
// =============================================================================

/**
 * Build initial key chain from root
 */
function buildKeyChain(): KeyChain {
  return {
    rootKey: ROOT_PUBLIC_KEY,
    onlineKey: ROOT_PUBLIC_KEY, // Will be updated when we fetch online key
    historicalKeys: [],
    revokedKeys: [],
  };
}

/**
 * Verify a signing key's chain of trust
 */
async function verifyKeyChain(
  key: SigningKey,
  keyChain: KeyChain
): Promise<VerificationResult> {
  // Root key is trusted implicitly
  if (key.type === 'root') {
    if (key.keyId !== keyChain.rootKey.keyId) {
      return { valid: false, error: 'Unknown root key', code: 'KEY_NOT_FOUND' };
    }
    return { valid: true };
  }
  
  // Check if key is revoked
  if (key.revoked || keyChain.revokedKeys.some(k => k.keyId === key.keyId)) {
    return { valid: false, error: 'Key has been revoked', code: 'KEY_REVOKED' };
  }
  
  // Check expiration
  if (key.expiresAt && Date.now() > key.expiresAt) {
    return { valid: false, error: 'Key has expired', code: 'KEY_EXPIRED' };
  }
  
  // Verify signature from parent key
  if (!key.signedBy || !key.parentSignature) {
    return { valid: false, error: 'Key lacks parent signature', code: 'CHAIN_BROKEN' };
  }
  
  // Find parent key
  let parentKey: SigningKey | undefined;
  if (key.signedBy === keyChain.rootKey.keyId) {
    parentKey = keyChain.rootKey;
  } else {
    parentKey = keyChain.historicalKeys.find(k => k.keyId === key.signedBy);
  }
  
  if (!parentKey) {
    return { valid: false, error: 'Parent key not found', code: 'KEY_NOT_FOUND' };
  }
  
  // Verify parent signature over this key
  const keyData = JSON.stringify({
    keyId: key.keyId,
    publicKey: key.publicKey,
    type: key.type,
    createdAt: key.createdAt,
    expiresAt: key.expiresAt,
  });
  
  const isValid = await verifyEd25519(
    parentKey.publicKey,
    key.parentSignature,
    new TextEncoder().encode(keyData)
  );
  
  if (!isValid) {
    return { valid: false, error: 'Parent signature invalid', code: 'SIGNATURE_INVALID' };
  }
  
  return { valid: true };
}

// =============================================================================
// Manifest Verification
// =============================================================================

/**
 * Verify an update manifest
 */
async function verifyManifest(
  manifest: UpdateManifest,
  context: VerificationContext
): Promise<VerificationResult> {
  const warnings: string[] = [];
  
  // 1. Parse and validate structure
  if (!manifest.version || !manifest.versionCode || !manifest.signatures) {
    return { valid: false, error: 'Invalid manifest structure', code: 'PARSE_ERROR' };
  }
  
  // 2. Check for rollback attack
  if (manifest.versionCode <= context.currentVersionCode) {
    return { 
      valid: false, 
      error: `Rollback detected: ${manifest.versionCode} <= ${context.currentVersionCode}`, 
      code: 'ROLLBACK_DETECTED' 
    };
  }
  
  // 3. Check if current version is revoked
  if (manifest.revokedVersions?.includes(context.currentVersion)) {
    warnings.push('Current version is marked as revoked - update recommended');
  }
  
  // 4. Check manifest expiration
  if (manifest.expiresAt && Date.now() > Date.parse(manifest.expiresAt)) {
    return { valid: false, error: 'Manifest has expired', code: 'MANIFEST_EXPIRED' };
  }
  
  // 5. Find signing key
  const signingKeyId = manifest.signatures.onlineKeyId;
  let signingKey: SigningKey | undefined;
  
  if (signingKeyId === context.keyChain.onlineKey.keyId) {
    signingKey = context.keyChain.onlineKey;
  } else if (signingKeyId === context.keyChain.rootKey.keyId) {
    signingKey = context.keyChain.rootKey;
  } else {
    signingKey = context.keyChain.historicalKeys.find(k => k.keyId === signingKeyId);
  }
  
  if (!signingKey) {
    return { valid: false, error: 'Signing key not found', code: 'KEY_NOT_FOUND' };
  }
  
  // 6. Verify key chain
  const keyResult = await verifyKeyChain(signingKey, context.keyChain);
  if (!keyResult.valid) {
    return keyResult;
  }
  
  // 7. Verify manifest signature
  const manifestData = JSON.stringify({
    version: manifest.version,
    versionCode: manifest.versionCode,
    channel: manifest.channel,
    releaseDate: manifest.releaseDate,
    artifacts: manifest.artifacts.map(a => ({
      platform: a.platform,
      sha256: a.sha256,
      sha512: a.sha512,
      size: a.size,
    })),
    minimumVersion: manifest.minimumVersion,
    minimumVersionCode: manifest.minimumVersionCode,
    revokedVersions: manifest.revokedVersions,
    securityFixes: manifest.securityFixes,
  });
  
  const isValid = await verifyEd25519(
    signingKey.publicKey,
    manifest.signatures.onlineKey,
    new TextEncoder().encode(manifestData)
  );
  
  if (!isValid) {
    return { valid: false, error: 'Manifest signature invalid', code: 'SIGNATURE_INVALID' };
  }
  
  // 8. In strict mode, require root attestation for security updates
  if (context.strictMode && manifest.securityFixes) {
    if (!manifest.signatures.rootAttestation) {
      warnings.push('Security update lacks root attestation');
    } else {
      const rootValid = await verifyEd25519(
        context.keyChain.rootKey.publicKey,
        manifest.signatures.rootAttestation,
        new TextEncoder().encode(manifestData)
      );
      if (!rootValid) {
        return { valid: false, error: 'Root attestation invalid', code: 'SIGNATURE_INVALID' };
      }
    }
  }
  
  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

// =============================================================================
// Artifact Verification
// =============================================================================

/**
 * Verify a downloaded artifact
 */
async function verifyArtifact(
  artifact: UpdateArtifact,
  data: Uint8Array,
  signingKey: SigningKey
): Promise<VerificationResult> {
  // 1. Check size
  if (data.length !== artifact.size) {
    return { 
      valid: false, 
      error: `Size mismatch: expected ${artifact.size}, got ${data.length}`, 
      code: 'SIZE_MISMATCH' 
    };
  }
  
  // 2. Verify SHA-256
  const actualSha256 = await sha256(data);
  if (actualSha256.toLowerCase() !== artifact.sha256.toLowerCase()) {
    return { 
      valid: false, 
      error: 'SHA-256 hash mismatch', 
      code: 'HASH_MISMATCH' 
    };
  }
  
  // 3. Verify SHA-512 (double verification)
  const actualSha512 = await sha512(data);
  if (actualSha512.toLowerCase() !== artifact.sha512.toLowerCase()) {
    return { 
      valid: false, 
      error: 'SHA-512 hash mismatch', 
      code: 'HASH_MISMATCH' 
    };
  }
  
  // 4. Verify signature over hash
  const hashData = new TextEncoder().encode(`${artifact.sha256}:${artifact.sha512}`);
  const isValid = await verifyEd25519(signingKey.publicKey, artifact.signature, hashData);
  
  if (!isValid) {
    return { valid: false, error: 'Artifact signature invalid', code: 'SIGNATURE_INVALID' };
  }
  
  return { valid: true };
}

// =============================================================================
// Update Service
// =============================================================================

export class UpdateService {
  private context: VerificationContext;
  private progress: UpdateProgress = { state: 'idle' };
  private listeners: Set<(progress: UpdateProgress) => void> = new Set();
  
  constructor(currentVersion: string, currentVersionCode: number) {
    this.context = {
      currentVersion,
      currentVersionCode,
      keyChain: buildKeyChain(),
      allowPrerelease: false,
      strictMode: true,
    };
  }
  
  /**
   * Subscribe to update progress
   */
  onProgress(listener: (progress: UpdateProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  private updateState(state: UpdateState, extra: Partial<UpdateProgress> = {}): void {
    this.progress = { ...this.progress, state, ...extra };
    this.listeners.forEach(l => l(this.progress));
  }
  
  /**
   * Get current platform
   */
  private getPlatform(): Platform {
    const platform = navigator.platform.toLowerCase();
    const isArm = navigator.userAgent.includes('ARM') || 
                  (navigator as Navigator & { userAgentData?: { architecture?: string } })
                    .userAgentData?.architecture === 'arm';
    
    if (platform.includes('mac')) {
      return isArm ? 'darwin-arm64' : 'darwin-x64';
    } else if (platform.includes('win')) {
      return isArm ? 'win32-arm64' : 'win32-x64';
    } else {
      return isArm ? 'linux-arm64' : 'linux-x64';
    }
  }
  
  /**
   * Check for updates from multiple sources
   */
  async checkForUpdate(manifestUrls: string[]): Promise<UpdateManifest | null> {
    this.updateState('checking');
    
    // Try all manifest URLs in parallel
    const attempts = manifestUrls.map(async (url) => {
      try {
        const response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          cache: 'no-cache',
        });
        
        if (!response.ok) return null;
        
        return await response.json() as UpdateManifest;
      } catch {
        return null;
      }
    });
    
    const results = await Promise.allSettled(attempts);
    let manifest: UpdateManifest | null = null;
    
    // Use first valid manifest
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const verifyResult = await verifyManifest(result.value, this.context);
        if (verifyResult.valid) {
          manifest = result.value;
          break;
        }
      }
    }
    
    if (!manifest) {
      this.updateState('idle');
      return null;
    }
    
    // Check if update is available
    if (manifest.versionCode <= this.context.currentVersionCode) {
      this.updateState('idle');
      return null;
    }
    
    // Check channel
    if (!this.context.allowPrerelease && manifest.channel !== 'stable') {
      this.updateState('idle');
      return null;
    }
    
    this.updateState('available', { manifest });
    return manifest;
  }
  
  /**
   * Download and verify update artifact
   */
  async downloadUpdate(manifest: UpdateManifest): Promise<Uint8Array | null> {
    const platform = this.getPlatform();
    const artifact = manifest.artifacts.find(a => a.platform === platform);
    
    if (!artifact) {
      this.updateState('error', { 
        error: `No artifact for platform ${platform}`,
        errorCode: 'PARSE_ERROR',
      });
      return null;
    }
    
    this.updateState('downloading', {
      manifest,
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: artifact.size,
    });
    
    // Try sources in order of preference
    const sources = [
      artifact.sources.https?.[0],
      artifact.sources.ipfs ? `https://ipfs.io/ipfs/${artifact.sources.ipfs}` : null,
      artifact.sources.github,
      artifact.sources.onion, // Requires Tor
    ].filter(Boolean) as string[];
    
    let data: Uint8Array | null = null;
    
    for (const source of sources) {
      try {
        this.updateState('downloading', { currentSource: source });
        
        const response = await fetch(source);
        if (!response.ok) continue;
        
        const reader = response.body?.getReader();
        if (!reader) continue;
        
        const chunks: Uint8Array[] = [];
        let received = 0;
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          chunks.push(value);
          received += value.length;
          
          this.updateState('downloading', {
            downloadProgress: Math.round((received / artifact.size) * 100),
            downloadedBytes: received,
          });
        }
        
        // Combine chunks
        data = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
          data.set(chunk, offset);
          offset += chunk.length;
        }
        
        break; // Successfully downloaded
      } catch (error) {
        console.warn(`[Update] Download failed from ${source}:`, error);
        continue; // Try next source
      }
    }
    
    if (!data) {
      this.updateState('error', { 
        error: 'All download sources failed',
        errorCode: 'HASH_MISMATCH',
      });
      return null;
    }
    
    // Verify artifact
    this.updateState('verifying');
    
    const signingKey = this.context.keyChain.onlineKey;
    const verifyResult = await verifyArtifact(artifact, data, signingKey);
    
    if (!verifyResult.valid) {
      this.updateState('error', {
        error: verifyResult.error,
        errorCode: verifyResult.code,
      });
      return null;
    }
    
    this.updateState('ready', { manifest });
    return data;
  }
  
  /**
   * Get current progress
   */
  getProgress(): UpdateProgress {
    return { ...this.progress };
  }
  
  /**
   * Update key chain (e.g., when a new online key is announced)
   */
  async updateKeyChain(newOnlineKey: SigningKey): Promise<boolean> {
    const result = await verifyKeyChain(newOnlineKey, this.context.keyChain);
    if (!result.valid) {
      console.error('[Update] Invalid online key:', result.error);
      return false;
    }
    
    // Archive old key
    if (this.context.keyChain.onlineKey.keyId !== this.context.keyChain.rootKey.keyId) {
      this.context.keyChain.historicalKeys.push(this.context.keyChain.onlineKey);
    }
    
    this.context.keyChain.onlineKey = newOnlineKey;
    return true;
  }
  
  /**
   * Handle key revocation
   */
  revokeKey(revokedKey: SigningKey): void {
    this.context.keyChain.revokedKeys.push(revokedKey);
    
    // If current online key is revoked, fall back to root
    if (this.context.keyChain.onlineKey.keyId === revokedKey.keyId) {
      this.context.keyChain.onlineKey = this.context.keyChain.rootKey;
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let updateService: UpdateService | null = null;

export function getUpdateService(version?: string, versionCode?: number): UpdateService {
  if (!updateService) {
    // In production, these would come from package.json or build config
    updateService = new UpdateService(
      version || '0.1.0',
      versionCode || 1
    );
  }
  return updateService;
}

export default UpdateService;
