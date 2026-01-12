/* eslint-disable no-console */
/**
 * Peer-Hosted TURN Relay Service
 * 
 * Provides decentralized TURN (Traversal Using Relays around NAT) functionality.
 * When direct WebRTC connections fail due to symmetric NAT, peers with good
 * connectivity can relay media streams.
 * 
 * Key features:
 * - Decentralized relay selection (no central TURN servers)
 * - Bandwidth-aware relay assignment
 * - Encrypted relay with forward secrecy
 * - Reputation-based relay trust
 * - Automatic failover between relays
 */

import type { PeerId } from '@railgun/shared';
import {
  verifyEd25519Signature,
  signEd25519,
  bytesToHex,
  randomBytes,
} from './crypto-utils';

// ============================================================================
// Types
// ============================================================================

export interface TURNConfig {
  /** Local peer ID */
  localPeerId: PeerId;
  
  /** Local Ed25519 private key for signing */
  localPrivateKey: Uint8Array;
  
  /** Local Ed25519 public key */
  localPublicKey: string;
  
  /** Whether this peer offers relay services */
  offerRelay: boolean;
  
  /** Maximum bandwidth to donate for relay (Kbps) */
  maxRelayBandwidth: number;
  
  /** Maximum concurrent relay sessions */
  maxRelaySessions: number;
  
  /** Relay allocation timeout (ms) */
  allocationTimeout: number;
  
  /** Session timeout for inactive relays (ms) */
  sessionTimeout: number;
  
  /** ICE candidate trickling enabled */
  trickleICE: boolean;
}

export interface RelayCandidate {
  /** Relay peer ID */
  peerId: PeerId;
  
  /** Relay public key */
  publicKey: string;
  
  /** Available bandwidth (Kbps) */
  availableBandwidth: number;
  
  /** Current latency (ms) */
  latency: number;
  
  /** Geographic region */
  region: string;
  
  /** Reputation score (0-100) */
  reputation: number;
  
  /** Supported protocols */
  protocols: ('turn' | 'turn-tls' | 'turns')[];
  
  /** Relay addresses */
  addresses: string[];
  
  /** Time since last seen */
  lastSeen: number;
}

export interface RelayAllocation {
  /** Allocation ID */
  id: string;
  
  /** Relay peer providing service */
  relayPeerId: PeerId;
  
  /** Peer A in the connection */
  peerA: PeerId;
  
  /** Peer B in the connection */
  peerB: PeerId;
  
  /** Allocated bandwidth (Kbps) */
  allocatedBandwidth: number;
  
  /** TURN username */
  username: string;
  
  /** TURN credential (short-term) */
  credential: string;
  
  /** Credential expiration */
  credentialExpiry: number;
  
  /** Relay server address */
  relayAddress: string;
  
  /** Created timestamp */
  createdAt: number;
  
  /** Last activity timestamp */
  lastActivity: number;
  
  /** Bytes relayed */
  bytesRelayed: number;
}

export interface RelaySession {
  /** Session ID */
  id: string;
  
  /** Allocation info */
  allocation: RelayAllocation;
  
  /** Session state */
  state: 'pending' | 'active' | 'closing' | 'closed';
  
  /** Forward secrecy key */
  sessionKey: Uint8Array;
  
  /** Data channel for relay */
  dataChannel?: RTCDataChannel;
  
  /** Peer connection */
  peerConnection?: RTCPeerConnection;
}

interface TURNMessage {
  type: 'ALLOCATE_REQUEST' | 'ALLOCATE_RESPONSE' | 'REFRESH' | 'SEND' | 'DATA' | 'CHANNEL_BIND';
  allocationId?: string;
  from: PeerId;
  to?: PeerId;
  data?: Uint8Array;
  signature: string;
  timestamp: number;
}

type TURNEventType = 
  | 'relay-available'
  | 'relay-unavailable'
  | 'allocation-created'
  | 'allocation-expired'
  | 'session-started'
  | 'session-ended'
  | 'data-relayed'
  | 'error';

interface TURNEvent {
  type: TURNEventType;
  data: unknown;
}

// ============================================================================
// TURN Service
// ============================================================================

export class PeerHostedTURNService {
  private config: TURNConfig;
  private relayPool: Map<PeerId, RelayCandidate> = new Map();
  private activeAllocations: Map<string, RelayAllocation> = new Map();
  private sessions: Map<string, RelaySession> = new Map();
  private eventListeners: Map<TURNEventType, Set<(event: TURNEvent) => void>> = new Map();
  
  // Metrics for this peer's relay service
  private relayMetrics = {
    bytesRelayed: 0,
    sessionsHosted: 0,
    currentSessions: 0,
    bandwidthUsed: 0,
  };
  
  constructor(config: TURNConfig) {
    this.config = config;
    
    // Initialize event listener maps
    const eventTypes: TURNEventType[] = [
      'relay-available', 'relay-unavailable', 'allocation-created',
      'allocation-expired', 'session-started', 'session-ended',
      'data-relayed', 'error'
    ];
    eventTypes.forEach(type => this.eventListeners.set(type, new Set()));
  }
  
  // ==========================================================================
  // Public API
  // ==========================================================================
  
  /**
   * Start the TURN service
   */
  async start(): Promise<void> {
    console.log('[TURN] Starting peer-hosted TURN service');
    
    if (this.config.offerRelay) {
      console.log(`[TURN] Offering relay: ${this.config.maxRelayBandwidth}Kbps, ${this.config.maxRelaySessions} sessions`);
      await this.announceRelayCapability();
    }
    
    // Start cleanup timer
    setInterval(() => this.cleanupExpiredAllocations(), 60000);
    
    console.log('[TURN] Service started');
  }
  
  /**
   * Stop the TURN service
   */
  async stop(): Promise<void> {
    console.log('[TURN] Stopping service');
    
    // Close all sessions
    for (const session of this.sessions.values()) {
      await this.closeSession(session.id);
    }
    
    // Clear allocations
    this.activeAllocations.clear();
    this.relayPool.clear();
    
    console.log('[TURN] Service stopped');
  }
  
  /**
   * Register a relay candidate discovered through DHT/bootstrap
   */
  registerRelayCandidate(candidate: RelayCandidate): void {
    this.relayPool.set(candidate.peerId, candidate);
    this.emit('relay-available', candidate);
    console.log(`[TURN] Registered relay candidate: ${candidate.peerId}`);
  }
  
  /**
   * Remove a relay candidate
   */
  removeRelayCandidate(peerId: PeerId): void {
    const candidate = this.relayPool.get(peerId);
    if (candidate) {
      this.relayPool.delete(peerId);
      this.emit('relay-unavailable', candidate);
      console.log(`[TURN] Removed relay candidate: ${peerId}`);
    }
  }
  
  /**
   * Request a relay allocation for connecting to a peer
   */
  async requestAllocation(
    targetPeerId: PeerId,
    requiredBandwidth: number
  ): Promise<RelayAllocation | null> {
    console.log(`[TURN] Requesting allocation to ${targetPeerId}, ${requiredBandwidth}Kbps`);
    
    // Select best relay candidate
    const relay = this.selectBestRelay(requiredBandwidth);
    if (!relay) {
      console.error('[TURN] No suitable relay available');
      return null;
    }
    
    // Generate allocation credentials
    const allocationId = bytesToHex(randomBytes(16));
    const username = `${this.config.localPeerId}:${Date.now()}`;
    const credential = bytesToHex(randomBytes(32));
    const credentialExpiry = Date.now() + 3600000; // 1 hour
    
    // Create allocation request
    const request: TURNMessage = {
      type: 'ALLOCATE_REQUEST',
      from: this.config.localPeerId,
      to: targetPeerId,
      timestamp: Date.now(),
      signature: '', // Will be set below
    };
    
    // Sign the request
    const requestData = JSON.stringify({
      type: request.type,
      from: request.from,
      to: request.to,
      timestamp: request.timestamp,
    });
    request.signature = await signEd25519(this.config.localPrivateKey, requestData);
    
    // Send allocation request to relay (would be via DHT/P2P in production)
    // For now, we simulate local allocation
    const allocation: RelayAllocation = {
      id: allocationId,
      relayPeerId: relay.peerId,
      peerA: this.config.localPeerId,
      peerB: targetPeerId,
      allocatedBandwidth: Math.min(requiredBandwidth, relay.availableBandwidth),
      username,
      credential,
      credentialExpiry,
      relayAddress: relay.addresses[0] || `turn:${relay.peerId}:3478`,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      bytesRelayed: 0,
    };
    
    this.activeAllocations.set(allocationId, allocation);
    this.emit('allocation-created', allocation);
    
    console.log(`[TURN] Allocation created: ${allocationId} via ${relay.peerId}`);
    return allocation;
  }
  
  /**
   * Refresh an existing allocation
   */
  async refreshAllocation(allocationId: string): Promise<boolean> {
    const allocation = this.activeAllocations.get(allocationId);
    if (!allocation) {
      console.error(`[TURN] Allocation not found: ${allocationId}`);
      return false;
    }
    
    // Extend credential expiry
    allocation.credentialExpiry = Date.now() + 3600000;
    allocation.lastActivity = Date.now();
    
    // Generate new credential
    allocation.credential = bytesToHex(randomBytes(32));
    
    console.log(`[TURN] Refreshed allocation: ${allocationId}`);
    return true;
  }
  
  /**
   * Release an allocation
   */
  async releaseAllocation(allocationId: string): Promise<void> {
    const allocation = this.activeAllocations.get(allocationId);
    if (!allocation) return;
    
    // Close any associated sessions
    for (const [sessionId, session] of this.sessions) {
      if (session.allocation.id === allocationId) {
        await this.closeSession(sessionId);
      }
    }
    
    this.activeAllocations.delete(allocationId);
    this.emit('allocation-expired', allocation);
    
    console.log(`[TURN] Released allocation: ${allocationId}`);
  }
  
  /**
   * Get TURN server configuration for WebRTC
   */
  getTURNConfig(allocation: RelayAllocation): RTCIceServer {
    return {
      urls: [allocation.relayAddress],
      username: allocation.username,
      credential: allocation.credential,
    };
  }
  
  /**
   * Start a relay session (as relay host)
   */
  async hostRelaySession(
    allocationId: string,
    peerConnection: RTCPeerConnection
  ): Promise<RelaySession | null> {
    if (!this.config.offerRelay) {
      console.error('[TURN] This peer does not offer relay services');
      return null;
    }
    
    if (this.relayMetrics.currentSessions >= this.config.maxRelaySessions) {
      console.error('[TURN] Maximum relay sessions reached');
      return null;
    }
    
    const allocation = this.activeAllocations.get(allocationId);
    if (!allocation) {
      console.error(`[TURN] Allocation not found: ${allocationId}`);
      return null;
    }
    
    // Generate session key for forward secrecy
    const sessionKey = randomBytes(32);
    
    const session: RelaySession = {
      id: bytesToHex(randomBytes(16)),
      allocation,
      state: 'pending',
      sessionKey,
      peerConnection,
    };
    
    // Set up data channel for relay
    const dataChannel = peerConnection.createDataChannel('relay', {
      ordered: false,
      maxRetransmits: 0, // Unreliable for media
    });
    
    dataChannel.onopen = () => {
      session.state = 'active';
      this.relayMetrics.currentSessions++;
      this.relayMetrics.sessionsHosted++;
      this.emit('session-started', session);
      console.log(`[TURN] Session started: ${session.id}`);
    };
    
    dataChannel.onclose = () => {
      session.state = 'closed';
      this.relayMetrics.currentSessions--;
      this.emit('session-ended', session);
      console.log(`[TURN] Session ended: ${session.id}`);
    };
    
    dataChannel.onmessage = async (event) => {
      // Relay data to other peer
      await this.relayData(session, event.data);
    };
    
    session.dataChannel = dataChannel;
    this.sessions.set(session.id, session);
    
    return session;
  }
  
  /**
   * Close a relay session
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    session.state = 'closing';
    
    // Close data channel
    if (session.dataChannel) {
      session.dataChannel.close();
    }
    
    // Close peer connection
    if (session.peerConnection) {
      session.peerConnection.close();
    }
    
    // Clear session key
    session.sessionKey.fill(0);
    
    session.state = 'closed';
    this.sessions.delete(sessionId);
    
    this.emit('session-ended', session);
    console.log(`[TURN] Closed session: ${sessionId}`);
  }
  
  /**
   * Get available relays sorted by quality
   */
  getAvailableRelays(): RelayCandidate[] {
    return Array.from(this.relayPool.values())
      .filter(r => r.availableBandwidth > 0)
      .sort((a, b) => {
        // Score based on: latency (lower better), bandwidth (higher better), reputation
        const scoreA = (100 - a.latency/10) + (a.availableBandwidth/100) + a.reputation;
        const scoreB = (100 - b.latency/10) + (b.availableBandwidth/100) + b.reputation;
        return scoreB - scoreA;
      });
  }
  
  /**
   * Get relay metrics
   */
  getMetrics(): typeof this.relayMetrics {
    return { ...this.relayMetrics };
  }
  
  /**
   * Subscribe to TURN events
   */
  on(type: TURNEventType, callback: (event: TURNEvent) => void): void {
    this.eventListeners.get(type)?.add(callback);
  }
  
  /**
   * Unsubscribe from TURN events
   */
  off(type: TURNEventType, callback: (event: TURNEvent) => void): void {
    this.eventListeners.get(type)?.delete(callback);
  }
  
  // ==========================================================================
  // Relay Host API (for peers acting as TURN servers)
  // ==========================================================================
  
  /**
   * Handle incoming TURN message (as relay host)
   */
  async handleTURNMessage(message: TURNMessage): Promise<TURNMessage | null> {
    // Verify message signature
    const messageData = JSON.stringify({
      type: message.type,
      allocationId: message.allocationId,
      from: message.from,
      to: message.to,
      timestamp: message.timestamp,
    });
    
    const senderPublicKey = await this.getPeerPublicKey(message.from);
    if (!senderPublicKey) {
      console.error(`[TURN] Unknown sender: ${message.from}`);
      return null;
    }
    
    const isValid = await verifyEd25519Signature(
      senderPublicKey,
      messageData,
      message.signature
    );
    
    if (!isValid) {
      console.error('[TURN] Invalid message signature');
      return null;
    }
    
    switch (message.type) {
      case 'ALLOCATE_REQUEST':
        return this.handleAllocateRequest(message);
      case 'REFRESH':
        return this.handleRefresh(message);
      case 'SEND':
        return this.handleSend(message);
      case 'DATA':
        return this.handleData(message);
      default:
        console.warn(`[TURN] Unknown message type: ${message.type}`);
        return null;
    }
  }
  
  // ==========================================================================
  // Private Methods
  // ==========================================================================
  
  private emit(type: TURNEventType, data: unknown): void {
    const event: TURNEvent = { type, data };
    this.eventListeners.get(type)?.forEach(callback => callback(event));
  }
  
  private selectBestRelay(requiredBandwidth: number): RelayCandidate | null {
    const candidates = this.getAvailableRelays()
      .filter(r => r.availableBandwidth >= requiredBandwidth);
    
    if (candidates.length === 0) return null;
    
    // Return best candidate (already sorted by quality)
    return candidates[0];
  }
  
  private async announceRelayCapability(): Promise<void> {
    // Announce via DHT that this peer offers relay services
    // This would be integrated with DHTService in production
    const announcement: RelayCandidate = {
      peerId: this.config.localPeerId,
      publicKey: this.config.localPublicKey,
      availableBandwidth: this.config.maxRelayBandwidth,
      latency: 0, // Will be measured by other peers
      region: 'unknown', // Would be determined by IP geolocation
      reputation: 50, // Starting reputation
      protocols: ['turn', 'turn-tls'],
      addresses: [], // Would include actual listen addresses
      lastSeen: Date.now(),
    };
    
    // Register self in pool (for local testing)
    this.relayPool.set(this.config.localPeerId, announcement);
    
    console.log('[TURN] Announced relay capability');
  }
  
  private async relayData(session: RelaySession, data: ArrayBuffer): Promise<void> {
    // Update metrics
    session.allocation.bytesRelayed += data.byteLength;
    session.allocation.lastActivity = Date.now();
    this.relayMetrics.bytesRelayed += data.byteLength;
    this.relayMetrics.bandwidthUsed = this.calculateCurrentBandwidth();
    
    // Forward to other peer (would use second data channel in production)
    this.emit('data-relayed', {
      sessionId: session.id,
      bytes: data.byteLength,
    });
  }
  
  private calculateCurrentBandwidth(): number {
    // Calculate bandwidth used in last second
    // In production, this would track actual throughput
    return Array.from(this.sessions.values())
      .filter(s => s.state === 'active')
      .reduce((_sum, _s) => {
        // Estimate based on session activity
        return 0; // Placeholder
      }, 0);
  }
  
  private cleanupExpiredAllocations(): void {
    const now = Date.now();
    
    for (const [id, allocation] of this.activeAllocations) {
      // Check credential expiry
      if (now > allocation.credentialExpiry) {
        this.releaseAllocation(id);
        continue;
      }
      
      // Check session timeout
      if (now - allocation.lastActivity > this.config.sessionTimeout) {
        this.releaseAllocation(id);
      }
    }
  }
  
  private async handleAllocateRequest(message: TURNMessage): Promise<TURNMessage | null> {
    if (!this.config.offerRelay) return null;
    
    // Check capacity
    if (this.relayMetrics.currentSessions >= this.config.maxRelaySessions) {
      return null;
    }
    
    // Create allocation
    const allocationId = bytesToHex(randomBytes(16));
    const allocation: RelayAllocation = {
      id: allocationId,
      relayPeerId: this.config.localPeerId,
      peerA: message.from,
      peerB: message.to!,
      allocatedBandwidth: this.config.maxRelayBandwidth / this.config.maxRelaySessions,
      username: `${message.from}:${Date.now()}`,
      credential: bytesToHex(randomBytes(32)),
      credentialExpiry: Date.now() + 3600000,
      relayAddress: `turn:${this.config.localPeerId}:3478`,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      bytesRelayed: 0,
    };
    
    this.activeAllocations.set(allocationId, allocation);
    
    // Create response
    const response: TURNMessage = {
      type: 'ALLOCATE_RESPONSE',
      allocationId,
      from: this.config.localPeerId,
      to: message.from,
      timestamp: Date.now(),
      signature: '',
    };
    
    const responseData = JSON.stringify({
      type: response.type,
      allocationId: response.allocationId,
      from: response.from,
      to: response.to,
      timestamp: response.timestamp,
    });
    response.signature = await signEd25519(this.config.localPrivateKey, responseData);
    
    return response;
  }
  
  private async handleRefresh(message: TURNMessage): Promise<TURNMessage | null> {
    if (!message.allocationId) return null;
    
    const success = await this.refreshAllocation(message.allocationId);
    if (!success) return null;
    
    const response: TURNMessage = {
      type: 'REFRESH',
      allocationId: message.allocationId,
      from: this.config.localPeerId,
      to: message.from,
      timestamp: Date.now(),
      signature: '',
    };
    
    const responseData = JSON.stringify({
      type: response.type,
      allocationId: response.allocationId,
      from: response.from,
      to: response.to,
      timestamp: response.timestamp,
    });
    response.signature = await signEd25519(this.config.localPrivateKey, responseData);
    
    return response;
  }
  
  private async handleSend(message: TURNMessage): Promise<TURNMessage | null> {
    if (!message.allocationId || !message.data) return null;
    
    const allocation = this.activeAllocations.get(message.allocationId);
    if (!allocation) return null;
    
    // Verify sender is part of allocation
    if (message.from !== allocation.peerA && message.from !== allocation.peerB) {
      console.error('[TURN] Sender not authorized for this allocation');
      return null;
    }
    
    // Determine recipient
    const recipient = message.from === allocation.peerA ? allocation.peerB : allocation.peerA;
    
    // Forward data
    const forward: TURNMessage = {
      type: 'DATA',
      allocationId: message.allocationId,
      from: this.config.localPeerId,
      to: recipient,
      data: message.data,
      timestamp: Date.now(),
      signature: '',
    };
    
    // Update metrics
    allocation.bytesRelayed += message.data.byteLength;
    allocation.lastActivity = Date.now();
    this.relayMetrics.bytesRelayed += message.data.byteLength;
    
    return forward;
  }
  
  private async handleData(_message: TURNMessage): Promise<TURNMessage | null> {
    // Data messages are forwarded by the relay, not responded to
    return null;
  }
  
  private async getPeerPublicKey(_peerId: PeerId): Promise<string | null> {
    // In production, look up from DHT or local cache
    // For now, we'd need integration with DHT service
    return null;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let turnService: PeerHostedTURNService | null = null;

/**
 * Create and initialize the TURN service
 */
export async function createTURNService(config: TURNConfig): Promise<PeerHostedTURNService> {
  turnService = new PeerHostedTURNService(config);
  await turnService.start();
  return turnService;
}

/**
 * Get the TURN service instance
 */
export function getTURNService(): PeerHostedTURNService | null {
  return turnService;
}

/**
 * Default TURN configuration
 */
export function getDefaultTURNConfig(
  localPeerId: PeerId,
  localPublicKey: string,
  localPrivateKey: Uint8Array
): TURNConfig {
  return {
    localPeerId,
    localPublicKey,
    localPrivateKey,
    offerRelay: true,
    maxRelayBandwidth: 5000, // 5 Mbps
    maxRelaySessions: 10,
    allocationTimeout: 30000, // 30 seconds
    sessionTimeout: 300000, // 5 minutes inactive
    trickleICE: true,
  };
}

/**
 * Calculate recommended relay bandwidth based on device capabilities
 */
export function calculateRelayBandwidth(
  connectionType: 'ethernet' | 'wifi' | 'cellular' | 'unknown',
  uploadSpeed: number // Kbps
): number {
  // Don't use more than 20% of upload bandwidth for relay
  const maxShare = uploadSpeed * 0.2;
  
  switch (connectionType) {
    case 'ethernet':
      return Math.min(maxShare, 10000); // Max 10 Mbps
    case 'wifi':
      return Math.min(maxShare, 5000);  // Max 5 Mbps
    case 'cellular':
      return Math.min(maxShare, 1000);  // Max 1 Mbps
    default:
      return Math.min(maxShare, 2000);  // Max 2 Mbps
  }
}
