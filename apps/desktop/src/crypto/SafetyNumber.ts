/**
 * Rail Gun - Safety Number Implementation
 * 
 * Implements Signal-inspired safety numbers for identity verification.
 * Safety numbers allow users to verify they're communicating with the
 * intended person and detect man-in-the-middle attacks.
 * 
 * NOTE: This implementation is INSPIRED BY Signal's approach but is NOT
 * interoperable with Signal clients. The fingerprints will not match
 * Signal's output. For true Signal compatibility, use libsignal's
 * canonical Fingerprint class.
 * 
 * SECURITY:
 * - Uses SHA-512 for fingerprint computation
 * - 60-digit numeric representation for human readability
 * - QR code support for easy verification
 * - Detects identity key changes and warns users
 * 
 * REFERENCE (not exact implementation):
 * Signal's NumericFingerprint: https://signal.org/docs/specifications/fingerprints/
 */

// Import will be from LocalKeyStore's libsodium instance
// We use a callback pattern to avoid importing libsodium directly
type HashFunction = (data: Uint8Array) => Uint8Array;

// ============================================================================
// CONSTANTS
// ============================================================================

/** Number of iterations for fingerprint computation */
const FINGERPRINT_ITERATIONS = 5200;

/** Version byte for fingerprint format */
const FINGERPRINT_VERSION = 0;

/** Length of numeric fingerprint segments */
const FINGERPRINT_SEGMENT_LENGTH = 5;

/** Number of segments per fingerprint */
const FINGERPRINT_SEGMENT_COUNT = 6;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Safety number representation
 */
export interface SafetyNumber {
  /** Numeric representation (60 digits, space-separated) */
  numeric: string;
  
  /** Raw fingerprint bytes for QR code */
  fingerprint: Uint8Array;
  
  /** Combined fingerprint of both parties */
  combined: Uint8Array;
  
  /** Local user's portion of the safety number */
  localPortion: string;
  
  /** Remote user's portion of the safety number */
  remotePortion: string;
}

/**
 * Identity verification status
 */
export interface IdentityStatus {
  /** Whether we have a stored identity for this user */
  hasStoredIdentity: boolean;
  
  /** Whether the current identity matches stored */
  identityMatches: boolean;
  
  /** Whether user has explicitly verified this identity */
  isVerified: boolean;
  
  /** When the identity was first seen */
  firstSeen?: Date;
  
  /** When the identity was last verified */
  lastVerified?: Date;
  
  /** Previous identity key if changed (for UI warning) */
  previousIdentityKey?: string;
}

/**
 * Stored identity record
 */
export interface StoredIdentity {
  /** User ID this identity belongs to */
  userId: string;
  
  /** Base64-encoded identity public key */
  identityKey: string;
  
  /** When first seen */
  firstSeen: string; // ISO date
  
  /** Whether explicitly verified */
  verified: boolean;
  
  /** When verified (if applicable) */
  verifiedAt?: string; // ISO date
  
  /** Trust level */
  trustLevel: 'tofu' | 'verified' | 'revoked';
}

// ============================================================================
// SAFETY NUMBER COMPUTATION
// ============================================================================

/**
 * Compute a fingerprint for one party.
 * 
 * This implements Signal's Fingerprint spec:
 * 1. Start with version || publicKey || stableIdentifier
 * 2. Hash iteratively 5200 times
 * 3. Each iteration: hash = SHA-512(hash || publicKey || stableIdentifier)
 */
function computeFingerprint(
  identityKey: Uint8Array,
  stableIdentifier: string,
  hashFn: HashFunction
): Uint8Array {
  const encoder = new TextEncoder();
  const identifierBytes = encoder.encode(stableIdentifier);
  
  // Initial hash input: version || publicKey || identifier
  const versionByte = new Uint8Array([FINGERPRINT_VERSION]);
  let hash = concatBytes(versionByte, identityKey, identifierBytes);
  
  // Iterate
  for (let i = 0; i < FINGERPRINT_ITERATIONS; i++) {
    const input = concatBytes(hash, identityKey, identifierBytes);
    hash = hashFn(input);
  }
  
  // Return first 30 bytes (will become 30 * 5-digit segments / 100000)
  return hash.slice(0, 30);
}

/**
 * Convert fingerprint bytes to 30-digit numeric string.
 * Each 5 bytes becomes 5 digits using mod 100000.
 */
function fingerprintToNumeric(fingerprint: Uint8Array): string {
  const segments: string[] = [];
  
  for (let i = 0; i < FINGERPRINT_SEGMENT_COUNT; i++) {
    const offset = i * 5;
    // Read 5 bytes as big-endian number, mod 100000
    const value = readBigEndian(fingerprint.slice(offset, offset + 5)) % BigInt(100000);
    segments.push(value.toString().padStart(FINGERPRINT_SEGMENT_LENGTH, '0'));
  }
  
  return segments.join(' ');
}

/**
 * Compute safety number between two parties.
 * 
 * The safety number is the concatenation of both fingerprints,
 * with the "lower" fingerprint first for consistency.
 */
export function computeSafetyNumber(
  localUserId: string,
  localIdentityKey: Uint8Array,
  remoteUserId: string,
  remoteIdentityKey: Uint8Array,
  hashFn: HashFunction
): SafetyNumber {
  // Compute individual fingerprints
  const localFingerprint = computeFingerprint(localIdentityKey, localUserId, hashFn);
  const remoteFingerprint = computeFingerprint(remoteIdentityKey, remoteUserId, hashFn);
  
  // Convert to numeric
  const localNumeric = fingerprintToNumeric(localFingerprint);
  const remoteNumeric = fingerprintToNumeric(remoteFingerprint);
  
  // Combine in consistent order (lexicographically smaller first)
  let combined: Uint8Array;
  let numeric: string;
  
  if (compareBytes(localFingerprint, remoteFingerprint) <= 0) {
    combined = concatBytes(localFingerprint, remoteFingerprint);
    numeric = `${localNumeric}\n${remoteNumeric}`;
  } else {
    combined = concatBytes(remoteFingerprint, localFingerprint);
    numeric = `${remoteNumeric}\n${localNumeric}`;
  }
  
  return {
    numeric,
    fingerprint: combined,
    combined,
    localPortion: localNumeric,
    remotePortion: remoteNumeric,
  };
}

/**
 * Format safety number for display.
 * Returns 12 groups of 5 digits, with line break in middle.
 */
export function formatSafetyNumber(safetyNumber: SafetyNumber): string {
  return safetyNumber.numeric;
}

/**
 * Generate QR code data for safety number.
 * Format: version (1) || combined fingerprint (60 bytes)
 */
export function getSafetyNumberQRData(safetyNumber: SafetyNumber): Uint8Array {
  const version = new Uint8Array([FINGERPRINT_VERSION]);
  return concatBytes(version, safetyNumber.combined);
}

/**
 * Verify a scanned QR code matches expected safety number.
 */
export function verifySafetyNumberQR(
  scannedData: Uint8Array,
  expectedSafetyNumber: SafetyNumber
): boolean {
  if (scannedData.length !== 61) { // 1 version + 60 fingerprint
    return false;
  }
  
  const version = scannedData[0];
  if (version !== FINGERPRINT_VERSION) {
    return false;
  }
  
  const fingerprint = scannedData.slice(1);
  return compareBytes(fingerprint, expectedSafetyNumber.combined) === 0;
}

// ============================================================================
// IDENTITY STORE MANAGEMENT
// ============================================================================

/**
 * Create an identity store manager for tracking peer identities.
 * Uses the provided LocalKeyStore for persistence.
 */
export function createIdentityStore(
  keyStore: {
    get(key: string): Promise<Uint8Array | null>;
    set(key: string, value: Uint8Array): Promise<void>;
    delete(key: string): Promise<void>;
    has(key: string): Promise<boolean>;
    listKeys(prefix: string): Promise<string[]>;
  }
) {
  const IDENTITY_PREFIX = 'peer_identity:';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  
  return {
    /**
     * Store or update a peer's identity.
     * Returns true if this is a NEW or CHANGED identity.
     */
    async storeIdentity(
      userId: string,
      identityKey: string
    ): Promise<{ isNew: boolean; hasChanged: boolean; previousKey?: string }> {
      const key = `${IDENTITY_PREFIX}${userId}`;
      const existing = await keyStore.get(key);
      
      if (!existing) {
        // First time seeing this user
        const record: StoredIdentity = {
          userId,
          identityKey,
          firstSeen: new Date().toISOString(),
          verified: false,
          trustLevel: 'tofu',
        };
        await keyStore.set(key, encoder.encode(JSON.stringify(record)));
        return { isNew: true, hasChanged: false };
      }
      
      // Check if identity changed
      const record: StoredIdentity = JSON.parse(decoder.decode(existing));
      
      if (record.identityKey === identityKey) {
        // Same identity, no change
        return { isNew: false, hasChanged: false };
      }
      
      // Identity changed! This is a security event.
      const previousKey = record.identityKey;
      const updatedRecord: StoredIdentity = {
        ...record,
        identityKey,
        verified: false, // Reset verification on key change
        trustLevel: 'tofu',
        verifiedAt: undefined,
      };
      await keyStore.set(key, encoder.encode(JSON.stringify(updatedRecord)));
      
      return { isNew: false, hasChanged: true, previousKey };
    },
    
    /**
     * Get stored identity for a user.
     */
    async getStoredIdentity(userId: string): Promise<StoredIdentity | null> {
      const key = `${IDENTITY_PREFIX}${userId}`;
      const data = await keyStore.get(key);
      if (!data) return null;
      return JSON.parse(decoder.decode(data));
    },
    
    /**
     * Check identity status for a user.
     */
    async checkIdentityStatus(
      userId: string,
      currentIdentityKey: string
    ): Promise<IdentityStatus> {
      const stored = await this.getStoredIdentity(userId);
      
      if (!stored) {
        return {
          hasStoredIdentity: false,
          identityMatches: false,
          isVerified: false,
        };
      }
      
      const matches = stored.identityKey === currentIdentityKey;
      
      return {
        hasStoredIdentity: true,
        identityMatches: matches,
        isVerified: stored.verified && matches,
        firstSeen: new Date(stored.firstSeen),
        lastVerified: stored.verifiedAt ? new Date(stored.verifiedAt) : undefined,
        previousIdentityKey: matches ? undefined : stored.identityKey,
      };
    },
    
    /**
     * Mark an identity as verified.
     */
    async markVerified(userId: string): Promise<void> {
      const key = `${IDENTITY_PREFIX}${userId}`;
      const data = await keyStore.get(key);
      if (!data) {
        throw new Error(`No stored identity for user ${userId}`);
      }
      
      const record: StoredIdentity = JSON.parse(decoder.decode(data));
      record.verified = true;
      record.verifiedAt = new Date().toISOString();
      record.trustLevel = 'verified';
      
      await keyStore.set(key, encoder.encode(JSON.stringify(record)));
    },
    
    /**
     * Revoke trust for an identity (user explicitly rejects).
     */
    async revokeTrust(userId: string): Promise<void> {
      const key = `${IDENTITY_PREFIX}${userId}`;
      const data = await keyStore.get(key);
      if (!data) return;
      
      const record: StoredIdentity = JSON.parse(decoder.decode(data));
      record.verified = false;
      record.trustLevel = 'revoked';
      
      await keyStore.set(key, encoder.encode(JSON.stringify(record)));
    },
    
    /**
     * Delete stored identity (for testing or account reset).
     */
    async deleteIdentity(userId: string): Promise<void> {
      const key = `${IDENTITY_PREFIX}${userId}`;
      await keyStore.delete(key);
    },
    
    /**
     * Get all stored identities.
     */
    async getAllIdentities(): Promise<StoredIdentity[]> {
      const keys = await keyStore.listKeys(IDENTITY_PREFIX);
      const identities: StoredIdentity[] = [];
      
      for (const key of keys) {
        const data = await keyStore.get(key);
        if (data) {
          identities.push(JSON.parse(decoder.decode(data)));
        }
      }
      
      return identities;
    },
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Concatenate multiple Uint8Arrays.
 */
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Compare two byte arrays lexicographically.
 */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

/**
 * Read bytes as big-endian BigInt.
 */
function readBigEndian(bytes: Uint8Array): bigint {
  let value = BigInt(0);
  for (const byte of bytes) {
    value = (value << BigInt(8)) | BigInt(byte);
  }
  return value;
}

// ============================================================================
// INTEGRATION HELPERS
// ============================================================================

/**
 * Create a hash function that produces 64-byte hashes.
 * Accepts either SHA-512 or BLAKE2b-512 from libsodium.
 */
export function createHashFunction(sodium: {
  crypto_generichash: (length: number, data: Uint8Array) => Uint8Array;
}): HashFunction {
  return (data: Uint8Array) => sodium.crypto_generichash(64, data);
}

/**
 * Compute safety number with base64-encoded keys.
 * Convenience wrapper for the common case.
 */
export function computeSafetyNumberFromBase64(
  localUserId: string,
  localIdentityKeyBase64: string,
  remoteUserId: string,
  remoteIdentityKeyBase64: string,
  hashFn: HashFunction
): SafetyNumber {
  const localKey = base64ToBytes(localIdentityKeyBase64);
  const remoteKey = base64ToBytes(remoteIdentityKeyBase64);
  
  return computeSafetyNumber(
    localUserId,
    localKey,
    remoteUserId,
    remoteKey,
    hashFn
  );
}

/**
 * Decode base64 to Uint8Array.
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode Uint8Array to base64.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
