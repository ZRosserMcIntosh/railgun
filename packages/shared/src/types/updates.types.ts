/**
 * Signed Update System Types
 * 
 * Cryptographically signed updates with multi-transport distribution.
 * Implements rollback protection and chain-of-trust verification.
 */

// =============================================================================
// Key Hierarchy Types
// =============================================================================

export interface SigningKey {
  /** Key identifier (fingerprint) */
  keyId: string;
  
  /** Ed25519 public key (base64) */
  publicKey: string;
  
  /** Key type in hierarchy */
  type: 'root' | 'online' | 'build';
  
  /** When key was created */
  createdAt: number;
  
  /** When key expires (online/build keys only) */
  expiresAt?: number;
  
  /** Key that signed this key (chain of trust) */
  signedBy?: string;
  
  /** Signature from parent key */
  parentSignature?: string;
  
  /** Whether key has been revoked */
  revoked: boolean;
  
  /** Revocation signature (from parent) */
  revocationSignature?: string;
  
  /** Reason for revocation */
  revocationReason?: string;
}

export interface KeyChain {
  /** Root public key (embedded in client) */
  rootKey: SigningKey;
  
  /** Current online signing key */
  onlineKey: SigningKey;
  
  /** Historical online keys (for verifying old releases) */
  historicalKeys: SigningKey[];
  
  /** Revoked keys */
  revokedKeys: SigningKey[];
}

// =============================================================================
// Update Manifest Types
// =============================================================================

export type Platform = 
  | 'darwin-x64'
  | 'darwin-arm64'
  | 'linux-x64'
  | 'linux-arm64'
  | 'win32-x64'
  | 'win32-arm64'
  | 'android-arm64'
  | 'ios-arm64';

export type UpdateChannel = 'stable' | 'beta' | 'canary' | 'security';

export interface ArtifactSources {
  /** HTTPS CDN URLs */
  https?: string[];
  
  /** IPFS CID */
  ipfs?: string;
  
  /** BitTorrent magnet link */
  torrent?: string;
  
  /** Tor hidden service URL */
  onion?: string;
  
  /** I2P URL */
  i2p?: string;
  
  /** GitHub release URL */
  github?: string;
}

export interface UpdateArtifact {
  /** Target platform */
  platform: Platform;
  
  /** Download sources (try all) */
  sources: ArtifactSources;
  
  /** SHA-256 hash of artifact */
  sha256: string;
  
  /** SHA-512 hash (double verification) */
  sha512: string;
  
  /** File size in bytes */
  size: number;
  
  /** Signature over the hash */
  signature: string;
  
  /** Filename */
  filename: string;
}

export interface UpdateManifest {
  /** Semantic version */
  version: string;
  
  /** Monotonic version code (rollback protection) */
  versionCode: number;
  
  /** Release channel */
  channel: UpdateChannel;
  
  /** Release timestamp (ISO) */
  releaseDate: string;
  
  /** Force update after this date (optional) */
  expiresAt?: string;
  
  /** Platform artifacts */
  artifacts: UpdateArtifact[];
  
  /** Minimum version to update from */
  minimumVersion?: string;
  
  /** Minimum version code */
  minimumVersionCode?: number;
  
  /** Known-bad versions that must upgrade */
  revokedVersions?: string[];
  
  /** Changelog (markdown) */
  changelog: string;
  
  /** Whether this includes security fixes */
  securityFixes: boolean;
  
  /** CVE identifiers if applicable */
  cveIds?: string[];
  
  /** Signatures */
  signatures: UpdateSignatures;
}

export interface UpdateSignatures {
  /** Primary signature by online key */
  onlineKey: string;
  
  /** Which online key signed */
  onlineKeyId: string;
  
  /** Optional root key attestation (high-security releases) */
  rootAttestation?: string;
  
  /** Build reproducibility attestations */
  buildAttestations?: BuildAttestation[];
}

export interface BuildAttestation {
  /** Builder identifier */
  builderId: string;
  
  /** Builder's public key */
  builderKey: string;
  
  /** Signature over artifact hashes */
  signature: string;
  
  /** Build timestamp */
  timestamp: number;
  
  /** Build environment hash */
  environmentHash: string;
}

// =============================================================================
// Update Verification Types
// =============================================================================

export type VerificationResult = 
  | { valid: true; warnings?: string[] }
  | { valid: false; error: string; code: VerificationErrorCode };

export type VerificationErrorCode =
  | 'SIGNATURE_INVALID'
  | 'KEY_EXPIRED'
  | 'KEY_REVOKED'
  | 'KEY_NOT_FOUND'
  | 'CHAIN_BROKEN'
  | 'HASH_MISMATCH'
  | 'SIZE_MISMATCH'
  | 'ROLLBACK_DETECTED'
  | 'VERSION_REVOKED'
  | 'MANIFEST_EXPIRED'
  | 'PARSE_ERROR';

export interface VerificationContext {
  /** Current installed version code */
  currentVersionCode: number;
  
  /** Current installed version */
  currentVersion: string;
  
  /** Key chain for verification */
  keyChain: KeyChain;
  
  /** Allow beta/canary channels */
  allowPrerelease: boolean;
  
  /** Strict mode (require root attestation) */
  strictMode: boolean;
}

// =============================================================================
// Update State Types
// =============================================================================

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'error';

export interface UpdateProgress {
  /** Current state */
  state: UpdateState;
  
  /** Available update (if any) */
  manifest?: UpdateManifest;
  
  /** Download progress (0-100) */
  downloadProgress?: number;
  
  /** Downloaded bytes */
  downloadedBytes?: number;
  
  /** Total bytes */
  totalBytes?: number;
  
  /** Current download source */
  currentSource?: string;
  
  /** Error message (if state === 'error') */
  error?: string;
  
  /** Error code */
  errorCode?: VerificationErrorCode;
}

// =============================================================================
// Config Gossip Types (Append-Only CRDT)
// =============================================================================

export type ConfigAction = 'set' | 'append' | 'remove' | 'merge';

export interface ConfigEntry {
  /** Entry UUID */
  id: string;
  
  /** Sequence number (per key, monotonic) */
  sequence: number;
  
  /** Config key path */
  key: string;
  
  /** Config value (JSON-serializable) */
  value: unknown;
  
  /** Operation type */
  action: ConfigAction;
  
  /** Timestamp */
  timestamp: number;
  
  /** Optional TTL */
  expiresAt?: number;
  
  /** Signature by online key */
  signature: string;
  
  /** Which key signed */
  signingKeyId: string;
}

export interface ConfigManifest {
  /** Manifest version (increments with changes) */
  manifestVersion: number;
  
  /** Append-only entry log */
  entries: ConfigEntry[];
  
  /** Merkle root for efficient sync */
  merkleRoot: string;
  
  /** Manifest signature */
  signature: string;
  
  /** Signing key ID */
  signingKeyId: string;
  
  /** Creation timestamp */
  timestamp: number;
}

export interface ConfigState {
  /** Computed config (from applying entries) */
  config: Record<string, unknown>;
  
  /** Last applied sequence per key */
  sequences: Record<string, number>;
  
  /** Manifest version */
  manifestVersion: number;
  
  /** Merkle root */
  merkleRoot: string;
}

// =============================================================================
// Gossip Protocol Types
// =============================================================================

export type GossipMessageType =
  | 'config_push'      // Push new config entry
  | 'config_pull'      // Request missing entries
  | 'config_sync'      // Full sync request
  | 'merkle_compare'   // Compare merkle roots
  | 'update_announce'  // Announce new update
  | 'revocation';      // Key/version revocation

export interface GossipMessage {
  /** Message type */
  type: GossipMessageType;
  
  /** Sender peer ID */
  from: string;
  
  /** Message ID (deduplication) */
  messageId: string;
  
  /** Payload */
  payload: unknown;
  
  /** TTL (hops remaining) */
  ttl: number;
  
  /** Timestamp */
  timestamp: number;
  
  /** Signature */
  signature: string;
}

export interface GossipConfig {
  /** Number of peers to gossip to */
  fanout: number;
  
  /** Max message age to accept (ms) */
  maxAge: number;
  
  /** Deduplication cache TTL (ms) */
  dedupeTTL: number;
  
  /** Max TTL for messages */
  maxTTL: number;
  
  /** Sync interval (ms) */
  syncInterval: number;
}

export const DEFAULT_GOSSIP_CONFIG: GossipConfig = {
  fanout: 6,
  maxAge: 300000, // 5 minutes
  dedupeTTL: 600000, // 10 minutes
  maxTTL: 10,
  syncInterval: 300000, // 5 minutes
};
