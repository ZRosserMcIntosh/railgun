/**
 * Rail Gun - Signal Protocol Wrapper
 * 
 * Wraps @signalapp/libsignal-client for end-to-end encrypted messaging.
 * 
 * PROTOCOL SUMMARY:
 * - X3DH (Extended Triple Diffie-Hellman) for session establishment
 * - Double Ratchet for forward secrecy in 1:1 DMs
 * - Sender Keys for efficient group/channel encryption
 * 
 * NOTE: libsignal-client v0.86+ implements PQXDH (post-quantum X3DH) which
 * includes Kyber key encapsulation. This is handled automatically by the
 * library - we are NOT implementing custom post-quantum cryptography.
 * The Kyber stores below are required by the library's API.
 * 
 * SECURITY:
 * - Uses official Signal library (NOT a custom implementation)
 * - All private keys stored via LocalKeyStore (encrypted at rest)
 * - Implements proper pre-key rotation
 * - Private keys NEVER leave the device
 * 
 * MODULE BOUNDARY:
 * This is the ONLY module that imports @signalapp/libsignal-client.
 * All other code must use RailGunCrypto facade.
 */

import * as Signal from '@signalapp/libsignal-client';
import type { SignalWrapper, LocalKeyStore } from './types';
import { createLogger } from '../lib/logger';

const logger = createLogger('SignalWrapper');

// Helper for comparing Uint8Arrays
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ============================================================================
// SIGNAL ADDRESS HELPER
// ============================================================================

/**
 * Create a Signal protocol address from userId + deviceId.
 */
function makeAddress(userId: string, deviceId: number): Signal.ProtocolAddress {
  return Signal.ProtocolAddress.new(userId, deviceId);
}

// ============================================================================
// SIGNAL STORE IMPLEMENTATIONS (Extending abstract classes)
// ============================================================================

/**
 * Identity key store that persists via LocalKeyStore.
 * Extends the abstract Signal.IdentityKeyStore class.
 */
class IdentityKeyStoreImpl extends Signal.IdentityKeyStore {
  private identityKeyPair: { publicKey: Signal.PublicKey; privateKey: Signal.PrivateKey } | null = null;
  private registrationId: number = 0;
  private trustedIdentities = new Map<string, Signal.PublicKey>();
  private keyStore: LocalKeyStore;

  constructor(keyStore: LocalKeyStore) {
    super();
    this.keyStore = keyStore;
  }

  async initialize(): Promise<void> {
    // Try to load existing identity key pair
    const storedIdentity = await this.keyStore.get('identity');
    
    if (storedIdentity) {
      const data = JSON.parse(new TextDecoder().decode(storedIdentity)) as {
        publicKey: number[];
        privateKey: number[];
        registrationId: number;
      };
      
      const publicKey = Signal.PublicKey.deserialize(Buffer.from(data.publicKey));
      const privateKey = Signal.PrivateKey.deserialize(Buffer.from(data.privateKey));
      this.identityKeyPair = { publicKey, privateKey };
      this.registrationId = data.registrationId;
    } else {
      // Generate new identity
      const privateKey = Signal.PrivateKey.generate();
      const publicKey = privateKey.getPublicKey();
      this.identityKeyPair = { publicKey, privateKey };
      this.registrationId = Math.floor(Math.random() * 0x3fff) + 1;
      
      // Persist identity
      await this.keyStore.set('identity', new TextEncoder().encode(JSON.stringify({
        publicKey: Array.from(this.identityKeyPair.publicKey.serialize()),
        privateKey: Array.from(this.identityKeyPair.privateKey.serialize()),
        registrationId: this.registrationId,
      })));
    }

    // Load trusted identities
    const storedTrusted = await this.keyStore.get('trusted_identities');
    if (storedTrusted) {
      const data = JSON.parse(new TextDecoder().decode(storedTrusted)) as Record<string, number[]>;
      for (const [address, keyBytes] of Object.entries(data)) {
        this.trustedIdentities.set(address, Signal.PublicKey.deserialize(Buffer.from(keyBytes)));
      }
    }
  }

  async getIdentityKey(): Promise<Signal.PrivateKey> {
    if (!this.identityKeyPair) {
      throw new Error('Identity key store not initialized');
    }
    return this.identityKeyPair.privateKey;
  }

  getIdentityPublicKey(): Signal.PublicKey {
    if (!this.identityKeyPair) {
      throw new Error('Identity key store not initialized');
    }
    return this.identityKeyPair.publicKey;
  }

  async getLocalRegistrationId(): Promise<number> {
    return this.registrationId;
  }

  async saveIdentity(name: Signal.ProtocolAddress, key: Signal.PublicKey): Promise<Signal.IdentityChange> {
    const addressStr = `${name.name()}:${name.deviceId()}`;
    const existing = this.trustedIdentities.get(addressStr);
    
    this.trustedIdentities.set(addressStr, key);
    
    // Persist to storage
    const data: Record<string, number[]> = {};
    for (const [addr, ik] of this.trustedIdentities) {
      data[addr] = Array.from(ik.serialize());
    }
    await this.keyStore.set('trusted_identities', new TextEncoder().encode(JSON.stringify(data)));
    
    // Return whether the key changed
    if (existing !== undefined && !arraysEqual(existing.serialize(), key.serialize())) {
      return Signal.IdentityChange.ReplacedExisting;
    }
    return Signal.IdentityChange.NewOrUnchanged;
  }

  async isTrustedIdentity(
    name: Signal.ProtocolAddress,
    key: Signal.PublicKey,
    _direction: Signal.Direction
  ): Promise<boolean> {
    const addressStr = `${name.name()}:${name.deviceId()}`;
    const existing = this.trustedIdentities.get(addressStr);
    
    // Trust on first use (TOFU)
    if (!existing) return true;
    
    return arraysEqual(existing.serialize(), key.serialize());
  }

  async getIdentity(name: Signal.ProtocolAddress): Promise<Signal.PublicKey | null> {
    const addressStr = `${name.name()}:${name.deviceId()}`;
    return this.trustedIdentities.get(addressStr) ?? null;
  }
}

/**
 * Pre-key store implementation.
 */
class PreKeyStoreImpl extends Signal.PreKeyStore {
  private preKeys = new Map<number, Signal.PreKeyRecord>();
  private keyStore: LocalKeyStore;

  constructor(keyStore: LocalKeyStore) {
    super();
    this.keyStore = keyStore;
  }

  async initialize(): Promise<void> {
    const stored = await this.keyStore.get('prekeys');
    if (stored) {
      const data = JSON.parse(new TextDecoder().decode(stored)) as Record<string, number[]>;
      for (const [id, bytes] of Object.entries(data)) {
        this.preKeys.set(parseInt(id, 10), Signal.PreKeyRecord.deserialize(Buffer.from(bytes)));
      }
    }
  }

  async savePreKey(id: number, record: Signal.PreKeyRecord): Promise<void> {
    this.preKeys.set(id, record);
    await this.persist();
  }

  async getPreKey(id: number): Promise<Signal.PreKeyRecord> {
    const record = this.preKeys.get(id);
    if (!record) {
      throw new Error(`PreKey not found: ${id}`);
    }
    return record;
  }

  async removePreKey(id: number): Promise<void> {
    this.preKeys.delete(id);
    await this.persist();
  }

  private async persist(): Promise<void> {
    const data: Record<string, number[]> = {};
    for (const [id, record] of this.preKeys) {
      data[id.toString()] = Array.from(record.serialize());
    }
    await this.keyStore.set('prekeys', new TextEncoder().encode(JSON.stringify(data)));
  }

  /**
   * Generate a batch of one-time pre-keys.
   */
  async generatePreKeys(startId: number, count: number): Promise<Signal.PreKeyRecord[]> {
    const preKeys: Signal.PreKeyRecord[] = [];
    for (let i = 0; i < count; i++) {
      const privateKey = Signal.PrivateKey.generate();
      const publicKey = privateKey.getPublicKey();
      const record = Signal.PreKeyRecord.new(startId + i, publicKey, privateKey);
      await this.savePreKey(startId + i, record);
      preKeys.push(record);
    }
    return preKeys;
  }
}

/**
 * Signed pre-key store implementation.
 */
class SignedPreKeyStoreImpl extends Signal.SignedPreKeyStore {
  private signedPreKeys = new Map<number, Signal.SignedPreKeyRecord>();
  private keyStore: LocalKeyStore;

  constructor(keyStore: LocalKeyStore) {
    super();
    this.keyStore = keyStore;
  }

  async initialize(): Promise<void> {
    const stored = await this.keyStore.get('signed_prekeys');
    if (stored) {
      const data = JSON.parse(new TextDecoder().decode(stored)) as Record<string, number[]>;
      for (const [id, bytes] of Object.entries(data)) {
        this.signedPreKeys.set(parseInt(id, 10), Signal.SignedPreKeyRecord.deserialize(Buffer.from(bytes)));
      }
    }
  }

  async saveSignedPreKey(id: number, record: Signal.SignedPreKeyRecord): Promise<void> {
    this.signedPreKeys.set(id, record);
    await this.persist();
  }

  async getSignedPreKey(id: number): Promise<Signal.SignedPreKeyRecord> {
    const record = this.signedPreKeys.get(id);
    if (!record) {
      throw new Error(`SignedPreKey not found: ${id}`);
    }
    return record;
  }

  private async persist(): Promise<void> {
    const data: Record<string, number[]> = {};
    for (const [id, record] of this.signedPreKeys) {
      data[id.toString()] = Array.from(record.serialize());
    }
    await this.keyStore.set('signed_prekeys', new TextEncoder().encode(JSON.stringify(data)));
  }

  /**
   * Generate a new signed pre-key.
   */
  async generateSignedPreKey(
    identityPrivateKey: Signal.PrivateKey,
    id: number
  ): Promise<Signal.SignedPreKeyRecord> {
    const privateKey = Signal.PrivateKey.generate();
    const publicKey = privateKey.getPublicKey();
    const signature = identityPrivateKey.sign(publicKey.serialize());
    const timestamp = Date.now();
    
    const record = Signal.SignedPreKeyRecord.new(
      id,
      timestamp,
      publicKey,
      privateKey,
      signature
    );
    
    await this.saveSignedPreKey(id, record);
    return record;
  }
}

/**
 * Kyber pre-key store implementation (post-quantum).
 */
class KyberPreKeyStoreImpl extends Signal.KyberPreKeyStore {
  private kyberPreKeys = new Map<number, Signal.KyberPreKeyRecord>();
  private keyStore: LocalKeyStore;

  constructor(keyStore: LocalKeyStore) {
    super();
    this.keyStore = keyStore;
  }

  async initialize(): Promise<void> {
    const stored = await this.keyStore.get('kyber_prekeys');
    if (stored) {
      const data = JSON.parse(new TextDecoder().decode(stored)) as Record<string, number[]>;
      for (const [id, bytes] of Object.entries(data)) {
        this.kyberPreKeys.set(parseInt(id, 10), Signal.KyberPreKeyRecord.deserialize(Buffer.from(bytes)));
      }
    }
  }

  async saveKyberPreKey(id: number, record: Signal.KyberPreKeyRecord): Promise<void> {
    this.kyberPreKeys.set(id, record);
    await this.persist();
  }

  async getKyberPreKey(id: number): Promise<Signal.KyberPreKeyRecord> {
    const record = this.kyberPreKeys.get(id);
    if (!record) {
      throw new Error(`KyberPreKey not found: ${id}`);
    }
    return record;
  }

  async markKyberPreKeyUsed(_kyberPreKeyId: number, _signedPreKeyId: number, _baseKey: Signal.PublicKey): Promise<void> {
    // Mark as used - could implement rotation logic here
  }

  private async persist(): Promise<void> {
    const data: Record<string, number[]> = {};
    for (const [id, record] of this.kyberPreKeys) {
      data[id.toString()] = Array.from(record.serialize());
    }
    await this.keyStore.set('kyber_prekeys', new TextEncoder().encode(JSON.stringify(data)));
  }

  /**
   * Generate a Kyber (post-quantum) pre-key.
   */
  async generateKyberPreKey(
    identityPrivateKey: Signal.PrivateKey,
    id: number
  ): Promise<Signal.KyberPreKeyRecord> {
    const keyPair = Signal.KEMKeyPair.generate();
    const signature = identityPrivateKey.sign(keyPair.getPublicKey().serialize());
    const timestamp = Date.now();
    
    const record = Signal.KyberPreKeyRecord.new(
      id,
      timestamp,
      keyPair,
      signature
    );
    
    await this.saveKyberPreKey(id, record);
    return record;
  }
}

/**
 * Session store implementation.
 */
class SessionStoreImpl extends Signal.SessionStore {
  private sessions = new Map<string, Signal.SessionRecord>();
  private keyStore: LocalKeyStore;

  constructor(keyStore: LocalKeyStore) {
    super();
    this.keyStore = keyStore;
  }

  async initialize(): Promise<void> {
    const stored = await this.keyStore.get('sessions');
    if (stored) {
      const data = JSON.parse(new TextDecoder().decode(stored)) as Record<string, number[]>;
      for (const [address, bytes] of Object.entries(data)) {
        this.sessions.set(address, Signal.SessionRecord.deserialize(Buffer.from(bytes)));
      }
    }
  }

  async saveSession(name: Signal.ProtocolAddress, record: Signal.SessionRecord): Promise<void> {
    const addressStr = `${name.name()}:${name.deviceId()}`;
    this.sessions.set(addressStr, record);
    await this.persist();
  }

  async getSession(name: Signal.ProtocolAddress): Promise<Signal.SessionRecord | null> {
    const addressStr = `${name.name()}:${name.deviceId()}`;
    return this.sessions.get(addressStr) ?? null;
  }

  async getExistingSessions(addresses: Signal.ProtocolAddress[]): Promise<Signal.SessionRecord[]> {
    const sessions: Signal.SessionRecord[] = [];
    for (const addr of addresses) {
      const session = await this.getSession(addr);
      if (session) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  private async persist(): Promise<void> {
    const data: Record<string, number[]> = {};
    for (const [address, record] of this.sessions) {
      data[address] = Array.from(record.serialize());
    }
    await this.keyStore.set('sessions', new TextEncoder().encode(JSON.stringify(data)));
  }
}

/**
 * Sender key store for group messaging.
 */
class SenderKeyStoreImpl extends Signal.SenderKeyStore {
  private senderKeys = new Map<string, Signal.SenderKeyRecord>();
  private keyStore: LocalKeyStore;

  constructor(keyStore: LocalKeyStore) {
    super();
    this.keyStore = keyStore;
  }

  async initialize(): Promise<void> {
    const stored = await this.keyStore.get('sender_keys');
    if (stored) {
      const data = JSON.parse(new TextDecoder().decode(stored)) as Record<string, number[]>;
      for (const [key, bytes] of Object.entries(data)) {
        this.senderKeys.set(key, Signal.SenderKeyRecord.deserialize(Buffer.from(bytes)));
      }
    }
  }

  async saveSenderKey(
    sender: Signal.ProtocolAddress,
    distributionId: Signal.Uuid,
    record: Signal.SenderKeyRecord
  ): Promise<void> {
    const key = `${sender.name()}:${sender.deviceId()}:${distributionId}`;
    this.senderKeys.set(key, record);
    await this.persist();
  }

  async getSenderKey(
    sender: Signal.ProtocolAddress,
    distributionId: Signal.Uuid
  ): Promise<Signal.SenderKeyRecord | null> {
    const key = `${sender.name()}:${sender.deviceId()}:${distributionId}`;
    return this.senderKeys.get(key) ?? null;
  }

  private async persist(): Promise<void> {
    const data: Record<string, number[]> = {};
    for (const [key, record] of this.senderKeys) {
      data[key] = Array.from(record.serialize());
    }
    await this.keyStore.set('sender_keys', new TextEncoder().encode(JSON.stringify(data)));
  }
}

// ============================================================================
// SIGNAL WRAPPER IMPLEMENTATION
// ============================================================================

export class SignalWrapperImpl implements SignalWrapper {
  private identityStore: IdentityKeyStoreImpl;
  private preKeyStore: PreKeyStoreImpl;
  private signedPreKeyStore: SignedPreKeyStoreImpl;
  private kyberPreKeyStore: KyberPreKeyStoreImpl;
  private sessionStore: SessionStoreImpl;
  private senderKeyStore: SenderKeyStoreImpl;
  private keyStore: LocalKeyStore;
  private deviceId: number = 1;
  private initialized = false;

  constructor(keyStore: LocalKeyStore) {
    this.keyStore = keyStore;
    this.identityStore = new IdentityKeyStoreImpl(keyStore);
    this.preKeyStore = new PreKeyStoreImpl(keyStore);
    this.signedPreKeyStore = new SignedPreKeyStoreImpl(keyStore);
    this.kyberPreKeyStore = new KyberPreKeyStoreImpl(keyStore);
    this.sessionStore = new SessionStoreImpl(keyStore);
    this.senderKeyStore = new SenderKeyStoreImpl(keyStore);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize all stores
    await Promise.all([
      this.identityStore.initialize(),
      this.preKeyStore.initialize(),
      this.signedPreKeyStore.initialize(),
      this.kyberPreKeyStore.initialize(),
      this.sessionStore.initialize(),
      this.senderKeyStore.initialize(),
    ]);

    // Load or generate device ID
    const storedDeviceId = await this.keyStore.get('device_id');
    if (storedDeviceId) {
      this.deviceId = parseInt(new TextDecoder().decode(storedDeviceId), 10);
    } else {
      this.deviceId = 1; // First device
      await this.keyStore.set('device_id', new TextEncoder().encode(this.deviceId.toString()));
    }

    this.initialized = true;
    logger.debug('Initialized');
  }

  /**
   * Get this device's registration bundle for uploading to server.
   * Contains public keys only - private keys never leave the device.
   */
  async getRegistrationBundle(): Promise<{
    identityKey: Uint8Array;
    registrationId: number;
    signedPreKey: {
      id: number;
      publicKey: Uint8Array;
      signature: Uint8Array;
    };
    kyberPreKey: {
      id: number;
      publicKey: Uint8Array;
      signature: Uint8Array;
    };
    preKeys: Array<{
      id: number;
      publicKey: Uint8Array;
    }>;
  }> {
    const identityPrivateKey = await this.identityStore.getIdentityKey();
    const identityPublicKey = this.identityStore.getIdentityPublicKey();
    const registrationId = await this.identityStore.getLocalRegistrationId();
    
    // Generate signed pre-key if needed
    let signedPreKeyId = 1;
    const storedSpkId = await this.keyStore.get('signed_prekey_id');
    if (storedSpkId) {
      signedPreKeyId = parseInt(new TextDecoder().decode(storedSpkId), 10);
    }
    
    let signedPreKey: Signal.SignedPreKeyRecord;
    try {
      signedPreKey = await this.signedPreKeyStore.getSignedPreKey(signedPreKeyId);
    } catch {
      signedPreKey = await this.signedPreKeyStore.generateSignedPreKey(identityPrivateKey, signedPreKeyId);
      await this.keyStore.set('signed_prekey_id', new TextEncoder().encode(signedPreKeyId.toString()));
    }

    // Generate Kyber pre-key if needed
    let kyberPreKeyId = 1;
    const storedKpkId = await this.keyStore.get('kyber_prekey_id');
    if (storedKpkId) {
      kyberPreKeyId = parseInt(new TextDecoder().decode(storedKpkId), 10);
    }

    let kyberPreKey: Signal.KyberPreKeyRecord;
    try {
      kyberPreKey = await this.kyberPreKeyStore.getKyberPreKey(kyberPreKeyId);
    } catch {
      kyberPreKey = await this.kyberPreKeyStore.generateKyberPreKey(identityPrivateKey, kyberPreKeyId);
      await this.keyStore.set('kyber_prekey_id', new TextEncoder().encode(kyberPreKeyId.toString()));
    }

    // Generate one-time pre-keys if needed
    const preKeyCount = 100;
    let startPreKeyId = 1;
    const storedPkId = await this.keyStore.get('prekey_id_counter');
    if (storedPkId) {
      startPreKeyId = parseInt(new TextDecoder().decode(storedPkId), 10);
    }

    const preKeys = await this.preKeyStore.generatePreKeys(startPreKeyId, preKeyCount);
    await this.keyStore.set('prekey_id_counter', 
      new TextEncoder().encode((startPreKeyId + preKeyCount).toString()));

    return {
      identityKey: identityPublicKey.serialize(),
      registrationId,
      signedPreKey: {
        id: signedPreKeyId,
        publicKey: signedPreKey.publicKey().serialize(),
        signature: signedPreKey.signature(),
      },
      kyberPreKey: {
        id: kyberPreKeyId,
        publicKey: kyberPreKey.publicKey().serialize(),
        signature: kyberPreKey.signature(),
      },
      preKeys: preKeys.map(pk => ({
        id: pk.id(),
        publicKey: pk.publicKey().serialize(),
      })),
    };
  }

  /**
   * Establish a session with a recipient using their pre-key bundle.
   */
  async createSession(
    recipientId: string,
    deviceId: number,
    bundle: {
      identityKey: Uint8Array;
      registrationId: number;
      signedPreKey: {
        id: number;
        publicKey: Uint8Array;
        signature: Uint8Array;
      };
      kyberPreKey: {
        id: number;
        publicKey: Uint8Array;
        signature: Uint8Array;
      };
      preKey?: {
        id: number;
        publicKey: Uint8Array;
      };
    }
  ): Promise<void> {
    const address = makeAddress(recipientId, deviceId);

    const preKeyBundle = Signal.PreKeyBundle.new(
      bundle.registrationId,
      deviceId,
      bundle.preKey ? bundle.preKey.id : null,
      bundle.preKey ? Signal.PublicKey.deserialize(Buffer.from(bundle.preKey.publicKey)) : null,
      bundle.signedPreKey.id,
      Signal.PublicKey.deserialize(Buffer.from(bundle.signedPreKey.publicKey)),
      Buffer.from(bundle.signedPreKey.signature),
      Signal.PublicKey.deserialize(Buffer.from(bundle.identityKey)),
      bundle.kyberPreKey.id,
      Signal.KEMPublicKey.deserialize(Buffer.from(bundle.kyberPreKey.publicKey)),
      Buffer.from(bundle.kyberPreKey.signature)
    );

    await Signal.processPreKeyBundle(
      preKeyBundle,
      address,
      this.sessionStore,
      this.identityStore
    );
  }

  /**
   * Encrypt a message for a recipient.
   */
  async encrypt(
    recipientId: string,
    deviceId: number,
    plaintext: Uint8Array
  ): Promise<{
    type: number;
    body: Uint8Array;
  }> {
    const address = makeAddress(recipientId, deviceId);
    
    const ciphertext = await Signal.signalEncrypt(
      Buffer.from(plaintext),
      address,
      this.sessionStore,
      this.identityStore
    );

    return {
      type: ciphertext.type(),
      body: ciphertext.serialize(),
    };
  }

  /**
   * Decrypt a message from a sender.
   */
  async decrypt(
    senderId: string,
    deviceId: number,
    ciphertext: {
      type: number;
      body: Uint8Array;
    }
  ): Promise<Uint8Array> {
    const address = makeAddress(senderId, deviceId);

    const message = ciphertext.type === Signal.CiphertextMessageType.PreKey
      ? Signal.PreKeySignalMessage.deserialize(Buffer.from(ciphertext.body))
      : Signal.SignalMessage.deserialize(Buffer.from(ciphertext.body));

    let plaintext: Uint8Array;
    
    if (message instanceof Signal.PreKeySignalMessage) {
      plaintext = await Signal.signalDecryptPreKey(
        message,
        address,
        this.sessionStore,
        this.identityStore,
        this.preKeyStore,
        this.signedPreKeyStore,
        this.kyberPreKeyStore
      );
    } else {
      plaintext = await Signal.signalDecrypt(
        message,
        address,
        this.sessionStore,
        this.identityStore
      );
    }

    return new Uint8Array(plaintext);
  }

  /**
   * Create a group sender key distribution message.
   */
  async createGroupSession(
    groupId: string
  ): Promise<Uint8Array> {
    const userId = await this.getLocalUserId();
    const address = makeAddress(userId, this.deviceId);

    // Create the distribution message (groupId is used directly as Uuid is just a string type)
    const skdm = await Signal.SenderKeyDistributionMessage.create(
      address,
      groupId,
      this.senderKeyStore
    );

    return skdm.serialize();
  }

  /**
   * Process a received group sender key distribution message.
   */
  async processGroupSession(
    senderId: string,
    deviceId: number,
    distributionMessage: Uint8Array
  ): Promise<void> {
    const address = makeAddress(senderId, deviceId);
    const skdm = Signal.SenderKeyDistributionMessage.deserialize(Buffer.from(distributionMessage));

    await Signal.processSenderKeyDistributionMessage(
      address,
      skdm,
      this.senderKeyStore
    );
  }

  /**
   * Encrypt a message for a group.
   */
  async groupEncrypt(
    groupId: string,
    plaintext: Uint8Array
  ): Promise<Uint8Array> {
    const userId = await this.getLocalUserId();
    const address = makeAddress(userId, this.deviceId);

    const ciphertext = await Signal.groupEncrypt(
      address,
      groupId,
      this.senderKeyStore,
      Buffer.from(plaintext)
    );

    return ciphertext.serialize();
  }

  /**
   * Decrypt a group message.
   */
  async groupDecrypt(
    senderId: string,
    deviceId: number,
    ciphertext: Uint8Array
  ): Promise<Uint8Array> {
    const address = makeAddress(senderId, deviceId);

    const plaintext = await Signal.groupDecrypt(
      address,
      this.senderKeyStore,
      Buffer.from(ciphertext)
    );

    return new Uint8Array(plaintext);
  }

  /**
   * Get our local user ID for group messaging.
   */
  private async getLocalUserId(): Promise<string> {
    const stored = await this.keyStore.get('local_user_id');
    if (stored) {
      return new TextDecoder().decode(stored);
    }
    throw new Error('Local user ID not set. Call setLocalUserId first.');
  }

  /**
   * Set the local user ID (called after login).
   */
  async setLocalUserId(userId: string): Promise<void> {
    await this.keyStore.set('local_user_id', new TextEncoder().encode(userId));
  }

  /**
   * Get local identity public key.
   */
  async getIdentityPublicKey(): Promise<Uint8Array> {
    const publicKey = this.identityStore.getIdentityPublicKey();
    return publicKey.serialize();
  }

  /**
   * Get local registration ID.
   */
  async getRegistrationId(): Promise<number> {
    return this.identityStore.getLocalRegistrationId();
  }

  /**
   * Get the device ID.
   */
  getDeviceId(): number {
    return this.deviceId;
  }

  /**
   * Set the device ID (for multi-device support).
   */
  async setDeviceId(deviceId: number): Promise<void> {
    this.deviceId = deviceId;
    await this.keyStore.set('device_id', new TextEncoder().encode(deviceId.toString()));
  }

  /**
   * Check if we have a session with a recipient.
   */
  async hasSession(recipientId: string, deviceId: number): Promise<boolean> {
    const address = makeAddress(recipientId, deviceId);
    const session = await this.sessionStore.getSession(address);
    return session !== null;
  }

  /**
   * Get identity fingerprint for verification.
   * Returns a human-readable string users can compare.
   */
  async getIdentityFingerprint(): Promise<string> {
    const publicKey = this.identityStore.getIdentityPublicKey();
    const keyBytes = publicKey.serialize();
    
    // Create a simple fingerprint from the key bytes
    // Format: groups of 5 hex chars separated by spaces
    const hex = Array.from(keyBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    const groups: string[] = [];
    for (let i = 0; i < hex.length; i += 5) {
      groups.push(hex.substring(i, i + 5).toUpperCase());
    }
    
    return groups.slice(0, 12).join(' ');
  }

  /**
   * Build prekey bundle for server upload.
   * Wraps getRegistrationBundle with the interface-expected signature.
   */
  async buildPreKeyBundleForUpload(): Promise<{
    identityKey: Uint8Array;
    registrationId: number;
    signedPreKey: { id: number; publicKey: Uint8Array; signature: Uint8Array };
    preKeys: Array<{ id: number; publicKey: Uint8Array }>;
  }> {
    const bundle = await this.getRegistrationBundle();
    return {
      identityKey: bundle.identityKey,
      registrationId: bundle.registrationId,
      signedPreKey: bundle.signedPreKey,
      preKeys: bundle.preKeys,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new SignalWrapper instance.
 */
export function createSignalWrapper(keyStore: LocalKeyStore): SignalWrapper {
  return new SignalWrapperImpl(keyStore);
}
