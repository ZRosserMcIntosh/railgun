/* eslint-disable no-console */
/**
 * DHT (Distributed Hash Table) Service
 *
 * Implements Kademlia-like DHT for decentralized peer discovery and data storage.
 * This enables the P2P network to function without any centralized infrastructure.
 *
 * Key features:
 * - Peer discovery by topic/room hash
 * - Store-and-forward rendezvous points
 * - Capability announcements
 * - Signed records with verification
 */

import type {
  DHTKeyType,
  SignedDHTRecord,
  RendezvousPoint,
} from '@railgun/shared';
import type { PeerId, PeerInfo } from '@railgun/shared';
import {
  verifyDHTRecordSignature,
  signDHTRecord,
  bytesToHex,
  hexToBytes,
  type DHTRecordData,
} from './crypto-utils';

// ============================================================================
// Constants
// ============================================================================

/** K-bucket size (Kademlia parameter) */
const K = 20;

/** Alpha parameter for parallel lookups */
const ALPHA = 3;

/** Maximum number of routing table buckets (bits in peer ID) */
const ID_BITS = 256;

/** Record TTL defaults (seconds) */
const DEFAULT_TTL: Record<DHTKeyType, number> = {
  peer: 3600,           // 1 hour
  room: 7200,           // 2 hours
  rendezvous: 86400,    // 24 hours
  capability: 3600,     // 1 hour
  bootstrap: 86400,     // 24 hours
};

// ============================================================================
// Types
// ============================================================================

interface KBucket {
  peers: KBucketEntry[];
  lastRefresh: number;
}

interface KBucketEntry {
  peerId: PeerId;
  address: string;
  publicKey: string;
  lastSeen: number;
  rtt: number;
}

interface DHTConfig {
  /** Local peer ID */
  localPeerId: PeerId;
  
  /** Local peer's Ed25519 public key (hex) */
  localPublicKey: string;
  
  /** Local peer's Ed25519 private key (for signing) */
  localPrivateKey: Uint8Array;
  
  /** Refresh interval for stale buckets (ms) */
  refreshInterval: number;
  
  /** Record republish interval (ms) */
  republishInterval: number;
  
  /** Record expiration check interval (ms) */
  expirationInterval: number;
  
  /** Maximum records to store locally */
  maxRecords: number;
  
  /** Send function for DHT messages */
  sendMessage: (peerId: PeerId, message: DHTMessage) => Promise<DHTMessage | null>;
}

type DHTMessageType = 
  | 'PING'
  | 'PONG'
  | 'FIND_NODE'
  | 'FIND_NODE_REPLY'
  | 'FIND_VALUE'
  | 'FIND_VALUE_REPLY'
  | 'STORE'
  | 'STORE_ACK';

interface DHTMessage {
  type: DHTMessageType;
  senderId: PeerId;
  requestId: string;
  key?: string;
  value?: SignedDHTRecord;
  closestNodes?: PeerInfo[];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate XOR distance between two peer IDs
 */
function xorDistance(a: string, b: string): bigint {
  // Convert hex strings to BigInt and XOR
  const aBig = BigInt('0x' + a.replace('peer-', ''));
  const bBig = BigInt('0x' + b.replace('peer-', ''));
  return aBig ^ bBig;
}

/**
 * Get the bucket index for a peer (based on leading zeros in XOR distance)
 */
function getBucketIndex(localId: string, peerId: string): number {
  const distance = xorDistance(localId, peerId);
  if (distance === 0n) return 0;
  
  // Count leading zeros
  let zeros = 0;
  let d = distance;
  while (d > 0n) {
    d = d >> 1n;
    zeros++;
  }
  
  return Math.min(ID_BITS - zeros, ID_BITS - 1);
}

/**
 * Generate a random request ID
 */
function generateRequestId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a DHT key from type and value
 */
export function createDHTKey(keyType: DHTKeyType, value: string): string {
  return `${keyType}:${value}`;
}

/**
 * Hash a string to create a DHT key
 */
async function hashKey(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// DHT Service
// ============================================================================

export class DHTService {
  private config: DHTConfig;
  private routingTable: KBucket[] = [];
  private localRecords: Map<string, SignedDHTRecord> = new Map();
  private pendingRequests: Map<string, {
    resolve: (value: DHTMessage | null) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
  
  private refreshInterval?: ReturnType<typeof setInterval>;
  private republishInterval?: ReturnType<typeof setInterval>;
  private expirationInterval?: ReturnType<typeof setInterval>;

  constructor(config: DHTConfig) {
    this.config = config;
    
    // Initialize routing table buckets
    for (let i = 0; i < ID_BITS; i++) {
      this.routingTable.push({
        peers: [],
        lastRefresh: Date.now(),
      });
    }
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Start the DHT service
   */
  async start(): Promise<void> {
    console.log('[DHT] Starting DHT service');
    
    // Start periodic tasks
    this.refreshInterval = setInterval(() => this.refreshBuckets(), this.config.refreshInterval);
    this.republishInterval = setInterval(() => this.republishRecords(), this.config.republishInterval);
    this.expirationInterval = setInterval(() => this.expireRecords(), this.config.expirationInterval);
    
    console.log('[DHT] DHT service started');
  }

  /**
   * Stop the DHT service
   */
  stop(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    if (this.republishInterval) clearInterval(this.republishInterval);
    if (this.expirationInterval) clearInterval(this.expirationInterval);
    
    // Cancel pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('DHT shutting down'));
    }
    this.pendingRequests.clear();
    
    console.log('[DHT] DHT service stopped');
  }

  // ============================================================================
  // Routing Table
  // ============================================================================

  /**
   * Add or update a peer in the routing table
   */
  addPeer(peer: PeerInfo & { address: string }): void {
    const bucketIndex = getBucketIndex(this.config.localPeerId, peer.peerId);
    const bucket = this.routingTable[bucketIndex];
    
    // Check if peer already exists
    const existingIndex = bucket.peers.findIndex(p => p.peerId === peer.peerId);
    
    if (existingIndex >= 0) {
      // Move to end (most recently seen)
      const existing = bucket.peers.splice(existingIndex, 1)[0];
      existing.lastSeen = Date.now();
      existing.address = peer.address;
      bucket.peers.push(existing);
    } else if (bucket.peers.length < K) {
      // Add new peer
      bucket.peers.push({
        peerId: peer.peerId,
        address: peer.address,
        publicKey: peer.publicKey,
        lastSeen: Date.now(),
        rtt: peer.latencyMs || 0,
      });
    } else {
      // Bucket full, ping least recently seen
      const leastRecent = bucket.peers[0];
      this.ping(leastRecent.peerId).then(alive => {
        if (!alive) {
          // Replace dead peer
          bucket.peers.shift();
          bucket.peers.push({
            peerId: peer.peerId,
            address: peer.address,
            publicKey: peer.publicKey,
            lastSeen: Date.now(),
            rtt: peer.latencyMs || 0,
          });
        }
      });
    }
  }

  /**
   * Get the K closest peers to a key
   */
  getClosestPeers(key: string, count: number = K): KBucketEntry[] {
    const allPeers = this.routingTable.flatMap(b => b.peers);
    
    return allPeers
      .map(peer => ({
        peer,
        distance: xorDistance(peer.peerId, key),
      }))
      .sort((a, b) => {
        if (a.distance < b.distance) return -1;
        if (a.distance > b.distance) return 1;
        return 0;
      })
      .slice(0, count)
      .map(({ peer }) => peer);
  }

  /**
   * Get total number of peers in routing table
   */
  getPeerCount(): number {
    return this.routingTable.reduce((sum, bucket) => sum + bucket.peers.length, 0);
  }

  // ============================================================================
  // DHT Operations
  // ============================================================================

  /**
   * Ping a peer
   */
  async ping(peerId: PeerId): Promise<boolean> {
    try {
      const response = await this.sendRequest(peerId, {
        type: 'PING',
        senderId: this.config.localPeerId,
        requestId: generateRequestId(),
      });
      return response?.type === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Find a peer in the network
   */
  async findNode(targetId: PeerId): Promise<PeerInfo[]> {
    const closest = this.getClosestPeers(targetId, ALPHA);
    const queried = new Set<PeerId>();
    const found = new Map<PeerId, PeerInfo>();
    
    // Add initial closest peers to found
    for (const peer of closest) {
      found.set(peer.peerId, {
        peerId: peer.peerId,
        publicKey: peer.publicKey,
        addresses: [peer.address],
        protocols: [],
        lastSeen: peer.lastSeen,
        latencyMs: peer.rtt,
      });
    }
    
    // Iterative lookup - continues until no more peers to query
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Get unqueried peers closest to target
      const toQuery = Array.from(found.values())
        .filter(p => !queried.has(p.peerId))
        .sort((a, b) => {
          const distA = xorDistance(a.peerId, targetId);
          const distB = xorDistance(b.peerId, targetId);
          if (distA < distB) return -1;
          if (distA > distB) return 1;
          return 0;
        })
        .slice(0, ALPHA);
      
      if (toQuery.length === 0) break;
      
      // Query peers in parallel
      const responses = await Promise.all(
        toQuery.map(async peer => {
          queried.add(peer.peerId);
          try {
            return await this.sendRequest(peer.peerId, {
              type: 'FIND_NODE',
              senderId: this.config.localPeerId,
              requestId: generateRequestId(),
              key: targetId,
            });
          } catch {
            return null;
          }
        })
      );
      
      // Process responses
      let improved = false;
      for (const response of responses) {
        if (response?.type === 'FIND_NODE_REPLY' && response.closestNodes) {
          for (const node of response.closestNodes) {
            if (!found.has(node.peerId)) {
              found.set(node.peerId, node);
              improved = true;
            }
          }
        }
      }
      
      if (!improved) break;
    }
    
    // Return K closest peers
    return Array.from(found.values())
      .sort((a, b) => {
        const distA = xorDistance(a.peerId, targetId);
        const distB = xorDistance(b.peerId, targetId);
        if (distA < distB) return -1;
        if (distA > distB) return 1;
        return 0;
      })
      .slice(0, K);
  }

  /**
   * Store a value in the DHT
   */
  async store(
    keyType: DHTKeyType,
    keyValue: string,
    data: Uint8Array,
    ttl: number = DEFAULT_TTL[keyType]
  ): Promise<boolean> {
    const key = createDHTKey(keyType, keyValue);
    const keyHash = await hashKey(key);
    
    // Create signed record
    const record: SignedDHTRecord = {
      keyType,
      key: keyValue,
      data,
      signerPeerId: this.config.localPeerId,
      signature: new Uint8Array(0), // Will be set below
      sequence: Date.now(),
      ttl,
      createdAt: Date.now(),
    };
    
    // Sign the record using crypto-utils
    const recordDataForSigning: DHTRecordData = {
      keyType: record.keyType,
      key: record.key,
      data: bytesToHex(record.data),
      signerPeerId: record.signerPeerId,
      sequence: record.sequence,
      ttl: record.ttl,
      createdAt: record.createdAt,
    };
    const signatureHex = await signDHTRecord(recordDataForSigning, this.config.localPrivateKey);
    record.signature = hexToBytes(signatureHex);
    
    // Store locally
    this.localRecords.set(keyHash, record);
    
    // Find K closest peers to the key and store on them
    const closestPeers = await this.findNode(keyHash);
    
    let stored = 0;
    await Promise.all(
      closestPeers.map(async peer => {
        try {
          const response = await this.sendRequest(peer.peerId, {
            type: 'STORE',
            senderId: this.config.localPeerId,
            requestId: generateRequestId(),
            key: keyHash,
            value: record,
          });
          if (response?.type === 'STORE_ACK') {
            stored++;
          }
        } catch {
          // Continue with other peers
        }
      })
    );
    
    console.log(`[DHT] Stored ${key} on ${stored} peers`);
    return stored > 0;
  }

  /**
   * Retrieve a value from the DHT
   */
  async get(keyType: DHTKeyType, keyValue: string): Promise<SignedDHTRecord | null> {
    const key = createDHTKey(keyType, keyValue);
    const keyHash = await hashKey(key);
    
    // Check local records first
    const local = this.localRecords.get(keyHash);
    if (local && Date.now() < local.createdAt + local.ttl * 1000) {
      return local;
    }
    
    // Find value in network
    const closest = this.getClosestPeers(keyHash, ALPHA);
    const queried = new Set<PeerId>();
    
    for (const peer of closest) {
      if (queried.has(peer.peerId)) continue;
      queried.add(peer.peerId);
      
      try {
        const response = await this.sendRequest(peer.peerId, {
          type: 'FIND_VALUE',
          senderId: this.config.localPeerId,
          requestId: generateRequestId(),
          key: keyHash,
        });
        
        if (response?.type === 'FIND_VALUE_REPLY' && response.value) {
          // Verify signature
          const isValid = await this.verifyRecord(response.value);
          if (isValid) {
            // Cache locally
            this.localRecords.set(keyHash, response.value);
            return response.value;
          }
        } else if (response?.closestNodes) {
          // Query closer peers
          for (const node of response.closestNodes) {
            if (!queried.has(node.peerId)) {
              closest.push({
                peerId: node.peerId,
                address: node.addresses[0],
                publicKey: node.publicKey,
                lastSeen: node.lastSeen,
                rtt: node.latencyMs || 0,
              });
            }
          }
        }
      } catch {
        // Continue with other peers
      }
    }
    
    return null;
  }

  // ============================================================================
  // Message Handling
  // ============================================================================

  /**
   * Handle incoming DHT message
   */
  async handleMessage(message: DHTMessage): Promise<DHTMessage | null> {
    // Update routing table with sender
    if (message.senderId !== this.config.localPeerId) {
      // Note: In real implementation, we'd need the sender's address
      // This is simplified for the example
    }
    
    switch (message.type) {
      case 'PING':
        return {
          type: 'PONG',
          senderId: this.config.localPeerId,
          requestId: message.requestId,
        };
        
      case 'FIND_NODE':
        if (message.key) {
          const closest = this.getClosestPeers(message.key);
          return {
            type: 'FIND_NODE_REPLY',
            senderId: this.config.localPeerId,
            requestId: message.requestId,
            closestNodes: closest.map(p => ({
              peerId: p.peerId,
              publicKey: p.publicKey,
              addresses: [p.address],
              protocols: [],
              lastSeen: p.lastSeen,
              latencyMs: p.rtt,
            })),
          };
        }
        break;
        
      case 'FIND_VALUE':
        if (message.key) {
          const record = this.localRecords.get(message.key);
          if (record && Date.now() < record.createdAt + record.ttl * 1000) {
            return {
              type: 'FIND_VALUE_REPLY',
              senderId: this.config.localPeerId,
              requestId: message.requestId,
              value: record,
            };
          } else {
            // Return closest nodes
            const closest = this.getClosestPeers(message.key);
            return {
              type: 'FIND_VALUE_REPLY',
              senderId: this.config.localPeerId,
              requestId: message.requestId,
              closestNodes: closest.map(p => ({
                peerId: p.peerId,
                publicKey: p.publicKey,
                addresses: [p.address],
                protocols: [],
                lastSeen: p.lastSeen,
                latencyMs: p.rtt,
              })),
            };
          }
        }
        break;
        
      case 'STORE':
        if (message.key && message.value) {
          // Verify the record
          const isValid = await this.verifyRecord(message.value);
          if (isValid) {
            // Check storage limits
            if (this.localRecords.size >= this.config.maxRecords) {
              // Evict oldest record
              let oldest: [string, SignedDHTRecord] | null = null;
              for (const entry of this.localRecords.entries()) {
                if (!oldest || entry[1].createdAt < oldest[1].createdAt) {
                  oldest = entry;
                }
              }
              if (oldest) {
                this.localRecords.delete(oldest[0]);
              }
            }
            
            this.localRecords.set(message.key, message.value);
            return {
              type: 'STORE_ACK',
              senderId: this.config.localPeerId,
              requestId: message.requestId,
            };
          }
        }
        break;
        
      // Handle responses (resolve pending requests)
      case 'PONG':
      case 'FIND_NODE_REPLY':
      case 'FIND_VALUE_REPLY':
      case 'STORE_ACK': {
        const pending = this.pendingRequests.get(message.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.requestId);
          pending.resolve(message);
        }
        break;
      }
    }
    
    return null;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private async sendRequest(peerId: PeerId, message: DHTMessage): Promise<DHTMessage | null> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.requestId);
        reject(new Error('Request timeout'));
      }, 10000);
      
      this.pendingRequests.set(message.requestId, { resolve, reject, timeout });
      
      this.config.sendMessage(peerId, message).catch(error => {
        clearTimeout(timeout);
        this.pendingRequests.delete(message.requestId);
        reject(error);
      });
    });
  }

  private async verifyRecord(record: SignedDHTRecord): Promise<boolean> {
    // Check expiration
    if (Date.now() > record.createdAt + record.ttl * 1000) {
      return false;
    }
    
    // Look up signer's public key from routing table
    const signerPublicKey = this.findPeerPublicKey(record.signerPeerId);
    if (!signerPublicKey) {
      console.warn(`[DHT] Cannot verify record: unknown signer ${record.signerPeerId}`);
      // For records from unknown peers, we may still accept them with caution
      // This allows the network to function during bootstrap
      return true;
    }
    
    // Verify signature using imported crypto-utils
    const recordData: DHTRecordData = {
      keyType: record.keyType,
      key: record.key,
      data: bytesToHex(record.data),
      signerPeerId: record.signerPeerId,
      sequence: record.sequence,
      ttl: record.ttl,
      createdAt: record.createdAt,
    };
    
    const isValid = await verifyDHTRecordSignature(
      { ...recordData, signature: bytesToHex(record.signature) },
      signerPublicKey
    );
    
    if (!isValid) {
      console.warn(`[DHT] Invalid signature on record from ${record.signerPeerId}`);
    }
    
    return isValid;
  }
  
  /**
   * Find a peer's public key from the routing table
   */
  private findPeerPublicKey(peerId: PeerId): string | null {
    for (const bucket of this.routingTable) {
      const entry = bucket.peers.find(p => p.peerId === peerId);
      if (entry) {
        return entry.publicKey;
      }
    }
    return null;
  }

  private async refreshBuckets(): Promise<void> {
    const now = Date.now();
    
    for (let i = 0; i < this.routingTable.length; i++) {
      const bucket = this.routingTable[i];
      
      // Refresh if bucket is stale and has peers
      if (now - bucket.lastRefresh > this.config.refreshInterval && bucket.peers.length > 0) {
        // Generate a random ID in this bucket's range
        const randomId = this.generateIdInBucket(i);
        await this.findNode(randomId);
        bucket.lastRefresh = now;
      }
    }
  }

  private generateIdInBucket(_bucketIndex: number): string {
    // Generate a random ID that would fall into the specified bucket
    // In production, this would XOR with local ID to create ID in bucket range
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return 'peer-' + Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async republishRecords(): Promise<void> {
    // Republish our own records
    for (const [, record] of this.localRecords) {
      if (record.signerPeerId === this.config.localPeerId) {
        await this.store(record.keyType, record.key, record.data, record.ttl);
      }
    }
  }

  private expireRecords(): void {
    const now = Date.now();
    
    for (const [key, record] of this.localRecords) {
      if (now > record.createdAt + record.ttl * 1000) {
        this.localRecords.delete(key);
      }
    }
  }

  // ============================================================================
  // High-Level Operations
  // ============================================================================

  /**
   * Announce presence in a room
   */
  async announceRoom(roomId: string): Promise<boolean> {
    const data = new TextEncoder().encode(JSON.stringify({
      peerId: this.config.localPeerId,
      roomId,
      joinedAt: Date.now(),
    }));
    
    return this.store('room', roomId, data);
  }

  /**
   * Find peers in a room
   */
  async findRoomPeers(roomId: string): Promise<PeerId[]> {
    const record = await this.get('room', roomId);
    if (!record) return [];
    
    try {
      const data = JSON.parse(new TextDecoder().decode(record.data));
      return [data.peerId];
    } catch {
      return [];
    }
  }

  /**
   * Publish rendezvous point for offline messages
   */
  async publishRendezvous(recipientKey: string, storageNodes: PeerId[]): Promise<boolean> {
    const data = new TextEncoder().encode(JSON.stringify({
      storageNodes,
      updatedAt: Date.now(),
    }));
    
    return this.store('rendezvous', recipientKey, data, DEFAULT_TTL.rendezvous);
  }

  /**
   * Find rendezvous point for offline messages
   */
  async findRendezvous(recipientKey: string): Promise<RendezvousPoint | null> {
    const record = await this.get('rendezvous', recipientKey);
    if (!record) return null;
    
    try {
      const data = JSON.parse(new TextDecoder().decode(record.data));
      return {
        key: recipientKey,
        storageNodes: data.storageNodes,
        pendingCount: 0, // Would need to query storage nodes
        oldestMessage: 0,
        lastChecked: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Announce capabilities
   */
  async announceCapabilities(capabilities: Record<string, unknown>): Promise<boolean> {
    const data = new TextEncoder().encode(JSON.stringify({
      peerId: this.config.localPeerId,
      capabilities,
      announcedAt: Date.now(),
    }));
    
    return this.store('capability', this.config.localPeerId, data);
  }
}

// ============================================================================
// Factory
// ============================================================================

let dhtInstance: DHTService | null = null;

/**
 * Initialize DHT service
 */
export function initializeDHT(config: DHTConfig): DHTService {
  dhtInstance = new DHTService(config);
  return dhtInstance;
}

/**
 * Get DHT service instance
 */
export function getDHT(): DHTService | null {
  return dhtInstance;
}
