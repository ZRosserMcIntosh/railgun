/**
 * Cryptographic Utilities for P2P Network
 * 
 * Ed25519 signature verification for:
 * - Bootstrap list signatures
 * - DHT record signatures
 * - Peer identity verification
 */

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify Ed25519 signature
 * 
 * @param publicKey - Hex-encoded public key (raw or SPKI format)
 * @param data - Data that was signed
 * @param signature - Hex-encoded signature
 * @returns True if signature is valid
 */
export async function verifyEd25519Signature(
  publicKey: string,
  data: Uint8Array | string,
  signature: string
): Promise<boolean> {
  try {
    const keyBytes = hexToBytes(publicKey);
    const sigBytes = hexToBytes(signature);
    const dataBytes = typeof data === 'string' 
      ? new TextEncoder().encode(data) 
      : data;
    
    // Create ArrayBuffers (crypto.subtle doesn't accept SharedArrayBuffer)
    const keyBuffer = new ArrayBuffer(keyBytes.length);
    new Uint8Array(keyBuffer).set(keyBytes);
    
    // Determine key format - SPKI keys start with 0x30 (48)
    const isSpki = keyBytes[0] === 0x30;
    
    const key = await crypto.subtle.importKey(
      isSpki ? 'spki' : 'raw',
      keyBuffer,
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    
    const sigBuffer = new ArrayBuffer(sigBytes.length);
    new Uint8Array(sigBuffer).set(sigBytes);
    
    const dataBuffer = new ArrayBuffer(dataBytes.length);
    new Uint8Array(dataBuffer).set(dataBytes);
    
    return await crypto.subtle.verify('Ed25519', key, sigBuffer, dataBuffer);
  } catch (error) {
    console.error('[CryptoUtils] Signature verification failed:', error);
    return false;
  }
}

/**
 * Sign data with Ed25519 private key
 * 
 * @param privateKey - Private key (PKCS8 format)
 * @param data - Data to sign
 * @returns Hex-encoded signature
 */
export async function signEd25519(
  privateKey: Uint8Array,
  data: Uint8Array | string
): Promise<string> {
  const dataBytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data;
  
  // Import private key
  const keyBuffer = new ArrayBuffer(privateKey.length);
  new Uint8Array(keyBuffer).set(privateKey);
  
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'Ed25519' },
    false,
    ['sign']
  );
  
  // Sign
  const dataBuffer = new ArrayBuffer(dataBytes.length);
  new Uint8Array(dataBuffer).set(dataBytes);
  
  const signature = await crypto.subtle.sign('Ed25519', key, dataBuffer);
  return bytesToHex(new Uint8Array(signature));
}

/**
 * Generate Ed25519 keypair
 */
export async function generateEd25519Keypair(): Promise<{
  publicKey: string;      // Hex-encoded raw public key
  privateKey: Uint8Array; // PKCS8 format
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  );
  
  const publicKeyBuffer = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  
  return {
    publicKey: bytesToHex(new Uint8Array(publicKeyBuffer)),
    privateKey: new Uint8Array(privateKeyBuffer),
  };
}

/**
 * Verify bootstrap list signature
 * 
 * @param list - Bootstrap list to verify
 * @param trustedSigningKeys - Map of signing key IDs to public keys
 * @returns True if signature is valid
 */
export async function verifyBootstrapListSignature(
  list: {
    version: number;
    updated: string;
    nodes: unknown[];
    dnsSeeds?: string[];
    ipfsManifests?: string[];
    signature: string;
    signingKeyId: string;
  },
  trustedSigningKeys: Map<string, string>
): Promise<boolean> {
  // Get the signing key
  const publicKey = trustedSigningKeys.get(list.signingKeyId);
  if (!publicKey) {
    console.error(`[CryptoUtils] Unknown signing key: ${list.signingKeyId}`);
    return false;
  }
  
  // Reconstruct signed data (excluding signature itself)
  const signedData = JSON.stringify({
    version: list.version,
    updated: list.updated,
    nodes: list.nodes,
    dnsSeeds: list.dnsSeeds,
    ipfsManifests: list.ipfsManifests,
  });
  
  return verifyEd25519Signature(publicKey, signedData, list.signature);
}

/**
 * Verify individual bootstrap node signature
 * 
 * @param node - Bootstrap node to verify  
 * @returns True if signature is valid (node signs itself with its own key)
 */
export async function verifyBootstrapNodeSignature(
  node: {
    peerId: string;
    addresses: Record<string, string[]>;
    publicKey: string;
    signature: string;
    capabilities: string[];
    addedAt: number;
  }
): Promise<boolean> {
  // Node signs its own identity
  const signedData = JSON.stringify({
    peerId: node.peerId,
    addresses: node.addresses,
    publicKey: node.publicKey,
    capabilities: node.capabilities,
    addedAt: node.addedAt,
  });
  
  return verifyEd25519Signature(node.publicKey, signedData, node.signature);
}

/**
 * DHT Record signature data structure
 */
export interface DHTRecordData {
  keyType: string;
  key: string;
  data: string; // Hex-encoded
  signerPeerId: string;
  sequence: number;
  ttl: number;
  createdAt: number;
}

/**
 * Verify DHT record signature
 * 
 * @param record - DHT record to verify
 * @param signerPublicKey - Public key of the signer
 * @returns True if signature is valid
 */
export async function verifyDHTRecordSignature(
  record: DHTRecordData & { signature: string },
  signerPublicKey: string
): Promise<boolean> {
  // Reconstruct signed data
  const signedData = JSON.stringify({
    keyType: record.keyType,
    key: record.key,
    data: record.data,
    signerPeerId: record.signerPeerId,
    sequence: record.sequence,
    ttl: record.ttl,
    createdAt: record.createdAt,
  });
  
  return verifyEd25519Signature(signerPublicKey, signedData, record.signature);
}

/**
 * Sign DHT record
 * 
 * @param record - Record data to sign
 * @param privateKey - Signer's private key
 * @returns Hex-encoded signature
 */
export async function signDHTRecord(
  record: DHTRecordData,
  privateKey: Uint8Array
): Promise<string> {
  const signedData = JSON.stringify({
    keyType: record.keyType,
    key: record.key,
    data: record.data,
    signerPeerId: record.signerPeerId,
    sequence: record.sequence,
    ttl: record.ttl,
    createdAt: record.createdAt,
  });
  
  return signEd25519(privateKey, signedData);
}

/**
 * Derive peer ID from public key (simplified)
 * In production, this would use multihash
 */
export function derivePeerIdFromPublicKey(publicKey: string): string {
  // Use first 32 chars of public key hash for ID
  return `12D3KooW${publicKey.slice(0, 44)}`;
}

/**
 * Verify that a peer ID matches a public key
 */
export function verifyPeerIdMatchesPublicKey(peerId: string, publicKey: string): boolean {
  const expectedPeerId = derivePeerIdFromPublicKey(publicKey);
  return peerId === expectedPeerId;
}

/**
 * HMAC-SHA256 for challenge-response authentication
 */
export async function hmacSha256(
  key: Uint8Array,
  data: Uint8Array
): Promise<Uint8Array> {
  const keyBuffer = new ArrayBuffer(key.length);
  new Uint8Array(keyBuffer).set(key);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const dataBuffer = new ArrayBuffer(data.length);
  new Uint8Array(dataBuffer).set(data);
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBuffer);
  return new Uint8Array(signature);
}

/**
 * SHA-256 hash
 */
export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const dataBytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data;
  
  const buffer = new ArrayBuffer(dataBytes.length);
  new Uint8Array(buffer).set(dataBytes);
  
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hash);
}

/**
 * Generate cryptographically secure random bytes
 */
export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Constant-time comparison to prevent timing attacks
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

/**
 * Trusted bootstrap signing keys
 * These are the public keys of the entities authorized to sign bootstrap lists
 */
export const TRUSTED_BOOTSTRAP_SIGNING_KEYS = new Map<string, string>([
  // Primary signing key (replace with actual production key)
  ['railgun-bootstrap-signer-2026', 'MCowBQYDK2VwAyEA_PRIMARY_SIGNING_KEY_REPLACE_IN_PRODUCTION____'],
  
  // Backup signing key (held in cold storage)
  ['railgun-bootstrap-backup-2026', 'MCowBQYDK2VwAyEA_BACKUP_SIGNING_KEY_REPLACE_IN_PRODUCTION_____'],
  
  // Emergency rotation key
  ['railgun-bootstrap-emergency-2026', 'MCowBQYDK2VwAyEA_EMERGENCY_SIGNING_KEY_REPLACE_IN_PRODUCTION_'],
]);
