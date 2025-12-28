/**
 * Rail Gun Pro - Entitlement Token System
 * 
 * Handles creation, verification, storage, and management of Pro entitlement tokens.
 * Tokens are Ed25519-signed JSON payloads that can be verified offline.
 * 
 * SECURITY:
 * - Private signing key is NEVER stored in client or repo
 * - Public key is embedded for offline verification
 * - Tokens are bound to user identity (public key)
 */

import sodium from 'libsodium-wrappers';
import {
  Capability,
  Plan,
  BillingPeriod,
  VerifiedEntitlement,
  PLAN_CAPABILITIES,
} from './capabilities';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Token format version */
export const TOKEN_VERSION = 1;

/** Token prefix for identification */
export const TOKEN_PREFIX = 'RAILGUN_PRO_V1.';

/** Clock skew grace period in seconds (5 minutes) */
export const CLOCK_SKEW_GRACE_SECONDS = 5 * 60;

/** Storage key for entitlement token */
export const ENTITLEMENT_STORAGE_KEY = 'railgun_pro_entitlement';

/** File extension for exported tokens */
export const TOKEN_FILE_EXTENSION = '.railgun-token';

/**
 * Public keys for token verification.
 * Multiple keys support key rotation.
 * 
 * The private key counterpart is kept OFFLINE and NEVER in this repo.
 * 
 * To generate a new keypair for production:
 * ```
 * node -e "const sodium = require('libsodium-wrappers'); sodium.ready.then(() => { const kp = sodium.crypto_sign_keypair(); console.log('Public:', sodium.to_base64(kp.publicKey)); console.log('Private (KEEP SECRET):', sodium.to_base64(kp.privateKey)); })"
 * ```
 */
export const ENTITLEMENT_PUBLIC_KEYS: string[] = [
  // Current production key (replace with actual key before production)
  // This is a PLACEHOLDER - generate real keys before release
  'RG5ldHdvcmtfcHJvX3B1YmxpY19rZXlfcGxhY2Vob2xkZXI=',
  
  // Previous keys for rotation (add here when rotating)
];

/**
 * Test/development signing keypair.
 * ONLY for local testing - NEVER use in production.
 * 
 * In production, tokens are signed by a secure backend service
 * with keys that never touch client code.
 */
export const TEST_KEYPAIR = {
  // These are for development/testing ONLY
  // Base64-encoded Ed25519 keypair
  publicKey: 'dGVzdF9wdWJsaWNfa2V5X3BsYWNlaG9sZGVy', // Placeholder
  privateKey: 'dGVzdF9wcml2YXRlX2tleV9wbGFjZWhvbGRlcg==', // Placeholder
};

// ============================================================================
// TYPES
// ============================================================================

/**
 * Raw token payload before signing.
 */
export interface EntitlementPayload {
  /** Token schema version */
  version: number;
  
  /** User's public identity key (base64) - token is bound to this */
  sub: string;
  
  /** Plan type */
  plan: Plan;
  
  /** Billing cycle */
  billingPeriod: BillingPeriod;
  
  /** When token was issued (Unix timestamp, seconds) */
  issuedAt: number;
  
  /** When token expires (Unix timestamp, seconds) */
  expiresAt: number;
  
  /** Capabilities granted */
  features: Capability[];
  
  /** Unique token identifier (UUID v4) */
  tokenId: string;
}

/**
 * Complete token with signature.
 */
export interface EntitlementToken {
  payload: EntitlementPayload;
  signature: string; // Base64url
}

/**
 * Result of token verification.
 */
export type VerificationResult =
  | { valid: true; entitlement: VerifiedEntitlement }
  | { valid: false; reason: VerificationError };

/**
 * Reasons why token verification can fail.
 */
export type VerificationError =
  | 'INVALID_FORMAT'
  | 'INVALID_PREFIX'
  | 'INVALID_SIGNATURE'
  | 'UNSUPPORTED_VERSION'
  | 'IDENTITY_MISMATCH'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'INVALID_PAYLOAD';

// ============================================================================
// INITIALIZATION
// ============================================================================

let sodiumReady = false;

async function ensureSodium(): Promise<void> {
  if (!sodiumReady) {
    await sodium.ready;
    sodiumReady = true;
  }
}

// ============================================================================
// BASE64URL ENCODING (URL-safe, no padding)
// ============================================================================

function base64urlEncode(data: Uint8Array): string {
  return sodium.to_base64(data, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function base64urlDecode(str: string): Uint8Array {
  return sodium.from_base64(str, sodium.base64_variants.URLSAFE_NO_PADDING);
}

// ============================================================================
// TOKEN PARSING
// ============================================================================

/**
 * Parse a token string into its components.
 * Does NOT verify the token.
 */
export function parseTokenString(tokenString: string): EntitlementToken | null {
  // Check prefix
  if (!tokenString.startsWith(TOKEN_PREFIX)) {
    return null;
  }
  
  // Remove prefix and split
  const rest = tokenString.slice(TOKEN_PREFIX.length);
  const parts = rest.split('.');
  
  if (parts.length !== 2) {
    return null;
  }
  
  const [payloadBase64, signature] = parts;
  
  try {
    const payloadBytes = base64urlDecode(payloadBase64);
    const payloadJson = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadJson) as EntitlementPayload;
    
    return { payload, signature };
  } catch {
    return null;
  }
}

/**
 * Serialize a token to string format.
 */
export async function serializeToken(token: EntitlementToken): Promise<string> {
  await ensureSodium();
  
  const payloadJson = JSON.stringify(token.payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const payloadBase64 = base64urlEncode(payloadBytes);
  
  return `${TOKEN_PREFIX}${payloadBase64}.${token.signature}`;
}

// ============================================================================
// TOKEN VERIFICATION
// ============================================================================

/**
 * Verify a token signature against known public keys.
 * Returns true if signature is valid for any known key.
 */
async function verifyTokenSignature(
  payloadBytes: Uint8Array,
  signatureBase64: string,
  publicKeys: string[]
): Promise<boolean> {
  await ensureSodium();
  
  try {
    const signature = base64urlDecode(signatureBase64);
    
    for (const pubKeyBase64 of publicKeys) {
      try {
        const publicKey = sodium.from_base64(pubKeyBase64);
        
        if (sodium.crypto_sign_verify_detached(signature, payloadBytes, publicKey)) {
          return true;
        }
      } catch {
        // Invalid key format, try next
        continue;
      }
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Verify an entitlement token.
 * 
 * @param tokenString - The full token string (with prefix)
 * @param userIdentityKey - User's public identity key (base64)
 * @param now - Current Unix timestamp in seconds (default: now)
 * @param publicKeys - Public keys to verify against (default: production keys)
 * @returns Verification result with entitlement or error reason
 */
export async function verifyEntitlementToken(
  tokenString: string,
  userIdentityKey: string,
  now?: number,
  publicKeys: string[] = ENTITLEMENT_PUBLIC_KEYS
): Promise<VerificationResult> {
  await ensureSodium();
  
  const currentTime = now ?? Math.floor(Date.now() / 1000);
  
  // Parse token
  if (!tokenString.startsWith(TOKEN_PREFIX)) {
    return { valid: false, reason: 'INVALID_PREFIX' };
  }
  
  const rest = tokenString.slice(TOKEN_PREFIX.length);
  const dotIndex = rest.lastIndexOf('.');
  
  if (dotIndex === -1) {
    return { valid: false, reason: 'INVALID_FORMAT' };
  }
  
  const payloadBase64 = rest.slice(0, dotIndex);
  const signatureBase64 = rest.slice(dotIndex + 1);
  
  let payload: EntitlementPayload;
  let payloadBytes: Uint8Array;
  
  try {
    payloadBytes = base64urlDecode(payloadBase64);
    const payloadJson = new TextDecoder().decode(payloadBytes);
    payload = JSON.parse(payloadJson) as EntitlementPayload;
  } catch {
    return { valid: false, reason: 'INVALID_PAYLOAD' };
  }
  
  // Verify signature
  const signatureValid = await verifyTokenSignature(
    payloadBytes,
    signatureBase64,
    publicKeys
  );
  
  if (!signatureValid) {
    return { valid: false, reason: 'INVALID_SIGNATURE' };
  }
  
  // Version check
  if (payload.version !== TOKEN_VERSION) {
    return { valid: false, reason: 'UNSUPPORTED_VERSION' };
  }
  
  // Identity binding
  if (payload.sub !== userIdentityKey) {
    return { valid: false, reason: 'IDENTITY_MISMATCH' };
  }
  
  // Not-before check (with grace)
  if (currentTime < payload.issuedAt - CLOCK_SKEW_GRACE_SECONDS) {
    return { valid: false, reason: 'NOT_YET_VALID' };
  }
  
  // Expiration check (with grace)
  if (currentTime > payload.expiresAt + CLOCK_SKEW_GRACE_SECONDS) {
    return { valid: false, reason: 'EXPIRED' };
  }
  
  // Success! Return verified entitlement
  const entitlement: VerifiedEntitlement = {
    plan: payload.plan,
    billingPeriod: payload.billingPeriod,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    features: payload.features,
    tokenId: payload.tokenId,
    sub: payload.sub,
  };
  
  return { valid: true, entitlement };
}

// ============================================================================
// TOKEN STORAGE (via Electron secure storage or localStorage)
// ============================================================================

/**
 * Check if we're running in Electron with secure storage.
 */
function isElectron(): boolean {
  return typeof window !== 'undefined' &&
         typeof window.electronAPI !== 'undefined' &&
         typeof window.electronAPI.secureStore !== 'undefined';
}

/**
 * Save entitlement token to secure storage.
 */
export async function saveEntitlementToken(tokenString: string): Promise<boolean> {
  if (isElectron()) {
    try {
      return await window.electronAPI.secureStore.set(ENTITLEMENT_STORAGE_KEY, tokenString);
    } catch (error) {
      console.error('[Entitlement] Failed to save to secure storage:', error);
      // Fall through to localStorage
    }
  }
  
  // Fallback to localStorage
  try {
    localStorage.setItem(ENTITLEMENT_STORAGE_KEY, tokenString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load entitlement token from secure storage.
 */
export async function loadEntitlementToken(): Promise<string | null> {
  if (isElectron()) {
    try {
      return await window.electronAPI.secureStore.get(ENTITLEMENT_STORAGE_KEY);
    } catch (error) {
      console.error('[Entitlement] Failed to load from secure storage:', error);
      // Fall through to localStorage
    }
  }
  
  // Fallback to localStorage
  try {
    return localStorage.getItem(ENTITLEMENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Clear entitlement token from storage.
 */
export async function clearEntitlementToken(): Promise<boolean> {
  if (isElectron()) {
    try {
      return await window.electronAPI.secureStore.delete(ENTITLEMENT_STORAGE_KEY);
    } catch (error) {
      console.error('[Entitlement] Failed to clear from secure storage:', error);
      // Fall through to localStorage
    }
  }
  
  // Fallback to localStorage
  try {
    localStorage.removeItem(ENTITLEMENT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// TOKEN IMPORT/EXPORT
// ============================================================================

/**
 * Export token to a string that can be saved to file.
 */
export async function exportEntitlementToken(): Promise<string | null> {
  return loadEntitlementToken();
}

/**
 * Import token from string (from file or paste).
 * Validates the token before storing.
 * 
 * @param tokenString - Token string to import
 * @param userIdentityKey - User's identity key for validation
 * @returns Verification result
 */
export async function importEntitlementToken(
  tokenString: string,
  userIdentityKey: string
): Promise<VerificationResult> {
  // Trim whitespace
  const cleaned = tokenString.trim();
  
  // Verify before storing
  const result = await verifyEntitlementToken(cleaned, userIdentityKey);
  
  if (result.valid) {
    await saveEntitlementToken(cleaned);
  }
  
  return result;
}

/**
 * Validate and load stored token for a user.
 * Returns the entitlement if valid, null if invalid/expired/missing.
 */
export async function loadAndVerifyEntitlement(
  userIdentityKey: string
): Promise<VerifiedEntitlement | null> {
  const tokenString = await loadEntitlementToken();
  
  if (!tokenString) {
    return null;
  }
  
  const result = await verifyEntitlementToken(tokenString, userIdentityKey);
  
  if (result.valid) {
    return result.entitlement;
  }
  
  // Token is invalid - could log reason for debugging
  console.warn('[Entitlement] Stored token is invalid:', result.reason);
  
  // If expired, keep it stored (user might renew)
  // If identity mismatch, clear it (wrong user)
  if (result.reason === 'IDENTITY_MISMATCH') {
    await clearEntitlementToken();
  }
  
  return null;
}

// ============================================================================
// TOKEN CREATION (for testing/development only)
// ============================================================================

/**
 * Generate a UUID v4.
 */
async function generateUUID(): Promise<string> {
  await ensureSodium();
  const bytes = sodium.randombytes_buf(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
  
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Create a signed entitlement token.
 * 
 * ⚠️ FOR TESTING ONLY - In production, tokens are created by a secure backend.
 * 
 * @param userIdentityKey - User's public identity key (base64)
 * @param plan - Plan type
 * @param billingPeriod - Billing cycle
 * @param durationDays - Token validity in days
 * @param privateKeyBase64 - Signing private key (base64)
 * @returns Signed token string
 */
export async function createEntitlementToken(
  userIdentityKey: string,
  plan: Plan,
  billingPeriod: BillingPeriod,
  durationDays: number,
  privateKeyBase64: string
): Promise<string> {
  await ensureSodium();
  
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (durationDays * 24 * 60 * 60);
  
  // Get capabilities for the plan
  const features = Array.from(PLAN_CAPABILITIES[plan]);
  
  const payload: EntitlementPayload = {
    version: TOKEN_VERSION,
    sub: userIdentityKey,
    plan,
    billingPeriod,
    issuedAt: now,
    expiresAt,
    features,
    tokenId: await generateUUID(),
  };
  
  // Serialize payload
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const payloadBase64 = base64urlEncode(payloadBytes);
  
  // Sign
  const privateKey = sodium.from_base64(privateKeyBase64);
  const signature = sodium.crypto_sign_detached(payloadBytes, privateKey);
  const signatureBase64 = base64urlEncode(signature);
  
  return `${TOKEN_PREFIX}${payloadBase64}.${signatureBase64}`;
}

/**
 * Generate a new Ed25519 keypair for signing.
 * 
 * ⚠️ FOR DEVELOPMENT ONLY
 * In production, keys are generated offline and stored securely.
 * 
 * @returns Base64-encoded keypair
 */
export async function generateSigningKeypair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  await ensureSodium();
  
  const keypair = sodium.crypto_sign_keypair();
  
  return {
    publicKey: sodium.to_base64(keypair.publicKey),
    privateKey: sodium.to_base64(keypair.privateKey),
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get days until token expiration.
 */
export function getDaysUntilExpiration(entitlement: VerifiedEntitlement): number {
  const now = Math.floor(Date.now() / 1000);
  const secondsLeft = entitlement.expiresAt - now;
  return Math.max(0, Math.ceil(secondsLeft / (24 * 60 * 60)));
}

/**
 * Check if token is expiring soon (within 7 days).
 */
export function isExpiringSoon(entitlement: VerifiedEntitlement): boolean {
  return getDaysUntilExpiration(entitlement) <= 7;
}

/**
 * Format expiration date for display.
 */
export function formatExpirationDate(entitlement: VerifiedEntitlement): string {
  const date = new Date(entitlement.expiresAt * 1000);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Get human-readable error message for verification failure.
 */
export function getVerificationErrorMessage(error: VerificationError): string {
  switch (error) {
    case 'INVALID_FORMAT':
      return 'Token format is invalid';
    case 'INVALID_PREFIX':
      return 'Token does not have the correct prefix';
    case 'INVALID_SIGNATURE':
      return 'Token signature is invalid - may be forged or corrupted';
    case 'UNSUPPORTED_VERSION':
      return 'Token version is not supported - app may need update';
    case 'IDENTITY_MISMATCH':
      return 'Token was issued for a different user';
    case 'EXPIRED':
      return 'Token has expired - please renew your subscription';
    case 'NOT_YET_VALID':
      return 'Token is not yet valid - check your system clock';
    case 'INVALID_PAYLOAD':
      return 'Token data is corrupted';
    default:
      return 'Unknown verification error';
  }
}

// ============================================================================
// DEEP LINK HANDLING
// ============================================================================

/**
 * Parse a token from a deep link URL.
 * Deep link format: railgun://pro/activate?token=RAILGUN_PRO_V1.xxx.yyy
 */
export function parseDeepLinkToken(url: string): string | null {
  try {
    const parsed = new URL(url);
    
    if (parsed.protocol !== 'railgun:') {
      return null;
    }
    
    if (parsed.pathname !== '//pro/activate' && parsed.pathname !== '/pro/activate') {
      return null;
    }
    
    const token = parsed.searchParams.get('token');
    return token;
  } catch {
    return null;
  }
}

/**
 * Create a deep link URL for a token.
 */
export function createDeepLinkUrl(tokenString: string): string {
  const encoded = encodeURIComponent(tokenString);
  return `railgun://pro/activate?token=${encoded}`;
}
