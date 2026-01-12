/* eslint-disable no-console */
/**
 * Rail Gun P2P Relay Service
 *
 * Core implementation of the decentralized peer-to-peer relay network.
 * Handles peer discovery, committee selection, message relaying, and reputation.
 */

import type {
  PeerId,
  PeerInfo,
  PeerReputation,
  RelayCommittee,
  CommitteeConfig,
  RelayEnvelope,
  RelayProof,
  RelayAck,
  P2PConfig,
  P2PEvent,
  P2PEventHandler,
  NetworkStats,
  PeerConnection,
  ProofOfWork,
  MessageSizeBucket,
  CommitteeMembership,
} from '@railgun/shared';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate SHA-256 hash of input
 */
async function sha256(data: string | Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const inputBytes = typeof data === 'string' ? encoder.encode(data) : data;
  // Create a fresh ArrayBuffer to avoid SharedArrayBuffer issues
  const buffer = new ArrayBuffer(inputBytes.length);
  new Uint8Array(buffer).set(inputBytes);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Count leading zero bits in a hex string
 */
function countLeadingZeros(hex: string): number {
  let zeros = 0;
  for (const char of hex) {
    const nibble = parseInt(char, 16);
    if (nibble === 0) {
      zeros += 4;
    } else {
      zeros += Math.clz32(nibble) - 28;
      break;
    }
  }
  return zeros;
}

/**
 * Generate random bytes as hex string
 */
function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Current epoch number based on config
 */
function getCurrentEpoch(config: CommitteeConfig): number {
  return Math.floor(Date.now() / config.epochDuration);
}

// ============================================================================
// Committee Selection
// ============================================================================

/**
 * Deterministically select committee members for a room
 *
 * Uses a seeded shuffle (Fisher-Yates) to ensure all peers
 * agree on committee composition without coordination.
 */
export async function selectCommittee(
  roomId: string,
  epoch: number,
  eligiblePeers: PeerInfo[],
  config: CommitteeConfig
): Promise<RelayCommittee> {
  // Generate deterministic seed
  const seedInput = `${roomId}:${epoch}`;
  const seed = await sha256(seedInput);

  // Sort peers by ID for consistent ordering
  const sortedPeers = [...eligiblePeers].sort((a, b) => a.peerId.localeCompare(b.peerId));

  // Seeded Fisher-Yates shuffle
  const shuffled = [...sortedPeers];
  let seedIndex = 0;

  for (let i = shuffled.length - 1; i > 0; i--) {
    // Use seed bytes to generate random index
    const seedByte = parseInt(seed.substr(seedIndex * 2, 2), 16);
    seedIndex = (seedIndex + 1) % 32;
    const j = seedByte % (i + 1);

    // Swap
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Take top N peers as committee
  const members = shuffled.slice(0, config.committeeSize).map((p) => p.peerId);

  return {
    roomId,
    epoch,
    members,
    size: members.length,
    activeAt: epoch * config.epochDuration,
    expiresAt: (epoch + 1) * config.epochDuration + config.handoffOverlap,
    selectionSeed: seed,
  };
}

/**
 * Get peer's committee membership for a room
 */
export function getCommitteeMembership(
  peerId: PeerId,
  committee: RelayCommittee
): CommitteeMembership | null {
  const memberIndex = committee.members.indexOf(peerId);
  if (memberIndex === -1) return null;

  return {
    roomId: committee.roomId,
    epoch: committee.epoch,
    role: memberIndex < Math.ceil(committee.size / 2) ? 'primary' : 'backup',
    assignedSlice: memberIndex,
    totalSlices: committee.size,
  };
}

// ============================================================================
// Proof of Work
// ============================================================================

/**
 * Generate proof of work for relay admission
 */
export async function generateProofOfWork(
  peerId: PeerId,
  difficulty: number
): Promise<ProofOfWork> {
  const timestamp = Date.now();
  let nonce = 0;
  let hash: string;

  // Mine until we find a hash with enough leading zeros
  do {
    nonce++;
    const input = `${peerId}:${timestamp}:${nonce}`;
    hash = await sha256(input);
  } while (countLeadingZeros(hash) < difficulty);

  return {
    peerId,
    timestamp,
    nonce: nonce.toString(),
    difficulty,
    hash,
  };
}

/**
 * Verify proof of work
 */
export async function verifyProofOfWork(proof: ProofOfWork): Promise<boolean> {
  // Check timestamp is recent (within 5 minutes)
  const now = Date.now();
  if (Math.abs(now - proof.timestamp) > 5 * 60 * 1000) {
    return false;
  }

  // Verify hash
  const input = `${proof.peerId}:${proof.timestamp}:${proof.nonce}`;
  const hash = await sha256(input);

  if (hash !== proof.hash) {
    return false;
  }

  // Verify difficulty
  return countLeadingZeros(hash) >= proof.difficulty;
}

// ============================================================================
// Message Padding
// ============================================================================

/**
 * Pad message to fixed size bucket to prevent traffic analysis
 */
export function padMessage(data: Uint8Array): { padded: Uint8Array; bucket: MessageSizeBucket } {
  const size = data.length;

  let targetSize: MessageSizeBucket;
  if (size <= 256) {
    targetSize = 256 as MessageSizeBucket;
  } else if (size <= 4096) {
    targetSize = 4096 as MessageSizeBucket;
  } else {
    targetSize = 65536 as MessageSizeBucket;
  }

  // Create padded array with random padding
  const padded = new Uint8Array(targetSize);
  padded.set(data);

  // Fill rest with random data
  const padding = new Uint8Array(targetSize - size);
  crypto.getRandomValues(padding);
  padded.set(padding, size);

  // Store original size in last 4 bytes (big-endian)
  const view = new DataView(padded.buffer);
  view.setUint32(targetSize - 4, size, false);

  return { padded, bucket: targetSize as MessageSizeBucket };
}

/**
 * Remove padding from message
 */
export function unpadMessage(padded: Uint8Array): Uint8Array {
  const view = new DataView(padded.buffer);
  const originalSize = view.getUint32(padded.length - 4, false);

  if (originalSize > padded.length - 4) {
    throw new Error('Invalid padding: size exceeds buffer');
  }

  return padded.slice(0, originalSize);
}

// ============================================================================
// Reputation Manager
// ============================================================================

export class ReputationManager {
  private reputations: Map<PeerId, PeerReputation> = new Map();
  private recentRelays: Map<PeerId, { success: boolean; latencyMs: number; timestamp: number }[]> =
    new Map();

  constructor(private config: P2PConfig) {}

  /**
   * Get reputation for a peer
   */
  getReputation(peerId: PeerId): PeerReputation | undefined {
    return this.reputations.get(peerId);
  }

  /**
   * Initialize reputation for new peer
   */
  initializePeer(peerId: PeerId): PeerReputation {
    const now = Date.now();
    const rep: PeerReputation = {
      peerId,
      uptimeScore: 50, // Start at 50%
      relaySuccessRate: 100, // Assume good until proven otherwise
      latencyP95: 200, // Assume reasonable latency
      totalRelayed: 0,
      blacklisted: false,
      lastSeen: now,
      firstSeen: now,
    };
    this.reputations.set(peerId, rep);
    return rep;
  }

  /**
   * Record a relay attempt
   */
  recordRelay(peerId: PeerId, success: boolean, latencyMs: number): void {
    let rep = this.reputations.get(peerId);
    if (!rep) {
      rep = this.initializePeer(peerId);
    }

    // Update last seen
    rep.lastSeen = Date.now();

    // Track recent relays
    let recent = this.recentRelays.get(peerId) || [];
    recent.push({ success, latencyMs, timestamp: Date.now() });

    // Keep last 1000 relays
    if (recent.length > 1000) {
      recent = recent.slice(-1000);
    }
    this.recentRelays.set(peerId, recent);

    // Calculate success rate
    const successCount = recent.filter((r) => r.success).length;
    rep.relaySuccessRate = (successCount / recent.length) * 100;

    // Calculate P95 latency
    const latencies = recent.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    rep.latencyP95 = latencies[p95Index] || latencyMs;

    // Update total
    if (success) {
      rep.totalRelayed++;
    }

    this.reputations.set(peerId, rep);
  }

  /**
   * Update uptime score based on heartbeat
   */
  recordHeartbeat(peerId: PeerId): void {
    const rep = this.reputations.get(peerId);
    if (!rep) return;

    const now = Date.now();
    const timeSinceLastSeen = now - rep.lastSeen;

    // Increase uptime score if peer is responsive
    if (timeSinceLastSeen < 60000) {
      // Last seen within 1 minute
      rep.uptimeScore = Math.min(100, rep.uptimeScore + 0.1);
    }

    rep.lastSeen = now;
    this.reputations.set(peerId, rep);
  }

  /**
   * Decay reputation for offline peer
   */
  decayReputation(peerId: PeerId): void {
    const rep = this.reputations.get(peerId);
    if (!rep) return;

    const now = Date.now();
    const offlineMinutes = (now - rep.lastSeen) / 60000;

    // Decay uptime score
    rep.uptimeScore = Math.max(0, rep.uptimeScore - offlineMinutes * 0.5);

    this.reputations.set(peerId, rep);
  }

  /**
   * Blacklist a misbehaving peer
   */
  blacklist(peerId: PeerId, reason: string): void {
    let rep = this.reputations.get(peerId);
    if (!rep) {
      rep = this.initializePeer(peerId);
    }

    rep.blacklisted = true;
    rep.blacklistReason = reason;
    this.reputations.set(peerId, rep);
  }

  /**
   * Get peers eligible for relay committee
   */
  getEligiblePeers(peers: PeerInfo[]): PeerInfo[] {
    const thresholds = this.config.reputation;

    return peers.filter((peer) => {
      const rep = this.reputations.get(peer.peerId);
      if (!rep) return false;
      if (rep.blacklisted) return false;
      if (rep.uptimeScore < thresholds.minUptime) return false;
      if (rep.relaySuccessRate < thresholds.minSuccessRate) return false;
      if (rep.latencyP95 > thresholds.maxLatencyP95) return false;
      return true;
    });
  }
}

// ============================================================================
// P2P Relay Service
// ============================================================================

export class P2PRelayService {
  private config: P2PConfig;
  private peerId: PeerId | null = null;
  private peers: Map<PeerId, PeerInfo> = new Map();
  private connections: Map<PeerId, PeerConnection> = new Map();
  private committees: Map<string, RelayCommittee> = new Map();
  private reputation: ReputationManager;
  private eventHandlers: Set<P2PEventHandler> = new Set();
  private stats: NetworkStats;

  constructor(config: P2PConfig) {
    this.config = config;
    this.reputation = new ReputationManager(config);
    this.stats = {
      connectedPeers: 0,
      knownPeers: 0,
      activeCommittees: 0,
      messagesRelayed: 0,
      bytesRelayed: 0,
      bandwidthIn: 0,
      bandwidthOut: 0,
      avgRelayLatency: 0,
      healthScore: 100,
    };
  }

  /**
   * Initialize the P2P network
   */
  async initialize(): Promise<void> {
    // Generate or load peer ID
    this.peerId = await this.generatePeerId();

    // Bootstrap from configured nodes
    for (const node of this.config.bootstrapNodes) {
      await this.connectToBootstrap(node);
    }

    // Start committee rotation timer
    this.startCommitteeRotation();

    // Start reputation decay timer
    this.startReputationDecay();

    console.log(`[P2P] Initialized with peer ID: ${this.peerId}`);
  }

  /**
   * Get our peer ID
   */
  getPeerId(): PeerId | null {
    return this.peerId;
  }

  /**
   * Get current network stats
   */
  getStats(): NetworkStats {
    return { ...this.stats };
  }

  /**
   * Subscribe to P2P events
   */
  on(handler: P2PEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Emit event to all handlers
   */
  private emit(event: P2PEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[P2P] Event handler error:', error);
      }
    }
  }

  /**
   * Generate a new peer ID from keypair
   */
  private async generatePeerId(): Promise<PeerId> {
    // In production, this would use libp2p's peer-id generation
    // For now, generate a random ID
    return `peer-${randomHex(16)}`;
  }

  /**
   * Connect to a bootstrap node
   */
  private async connectToBootstrap(_multiaddr: string): Promise<void> {
    // In production, this would use libp2p to connect
    console.log(`[P2P] Connecting to bootstrap node...`);
  }

  /**
   * Start committee rotation timer
   */
  private startCommitteeRotation(): void {
    setInterval(async () => {
      const currentEpoch = getCurrentEpoch(this.config.committee);

      for (const [roomId, committee] of this.committees) {
        if (committee.epoch < currentEpoch) {
          // Rotate committee
          const eligiblePeers = this.reputation.getEligiblePeers(Array.from(this.peers.values()));
          const newCommittee = await selectCommittee(
            roomId,
            currentEpoch,
            eligiblePeers,
            this.config.committee
          );

          this.committees.set(roomId, newCommittee);

          this.emit({
            type: 'committee_rotated',
            oldCommittee: committee,
            newCommittee,
          });
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Start reputation decay timer
   */
  private startReputationDecay(): void {
    setInterval(() => {
      const now = Date.now();

      for (const [peerId] of this.peers) {
        const rep = this.reputation.getReputation(peerId);
        if (rep && now - rep.lastSeen > 5 * 60000) {
          // 5 minutes offline
          this.reputation.decayReputation(peerId);
        }
      }
    }, 60000); // Every minute
  }

  /**
   * Join a room and get/create its committee
   */
  async joinRoom(roomId: string): Promise<RelayCommittee> {
    let committee = this.committees.get(roomId);

    if (!committee) {
      const epoch = getCurrentEpoch(this.config.committee);
      const eligiblePeers = this.reputation.getEligiblePeers(Array.from(this.peers.values()));
      committee = await selectCommittee(roomId, epoch, eligiblePeers, this.config.committee);
      this.committees.set(roomId, committee);

      this.emit({ type: 'committee_formed', committee });
    }

    return committee;
  }

  /**
   * Leave a room
   */
  leaveRoom(roomId: string): void {
    this.committees.delete(roomId);
  }

  /**
   * Relay an encrypted message
   */
  async relayMessage(envelope: RelayEnvelope): Promise<RelayAck[]> {
    const committee = this.committees.get(envelope.roomId);
    if (!committee) {
      throw new Error(`Not joined to room: ${envelope.roomId}`);
    }

    // Verify relay proof
    if (!(await this.verifyRelayProof(envelope.relayProof))) {
      throw new Error('Invalid relay proof');
    }

    // Send to committee members
    const acks: RelayAck[] = [];
    const startTime = Date.now();

    for (const memberId of committee.members) {
      try {
        const ack = await this.sendToRelay(memberId, envelope);
        acks.push(ack);

        // Record successful relay
        const latency = Date.now() - startTime;
        this.reputation.recordRelay(memberId, true, latency);
      } catch (error) {
        // Record failed relay
        this.reputation.recordRelay(memberId, false, 0);
        acks.push({
          envelopeId: envelope.envelopeId,
          status: 'rejected',
          relayedBy: memberId,
          timestamp: Date.now(),
          error: String(error),
        });
      }
    }

    // Update stats
    this.stats.messagesRelayed++;
    this.stats.bytesRelayed += envelope.ciphertext.length;

    return acks;
  }

  /**
   * Verify a relay proof
   */
  private async verifyRelayProof(proof: RelayProof): Promise<boolean> {
    if (proof.expiresAt < Date.now()) {
      return false;
    }

    switch (proof.type) {
      case 'pow':
        return verifyProofOfWork(JSON.parse(proof.data));
      case 'reputation': {
        // Verify peer has sufficient reputation
        const rep = this.reputation.getReputation(proof.data);
        return rep !== undefined && !rep.blacklisted;
      }
      default:
        return false;
    }
  }

  /**
   * Send envelope to a relay peer
   */
  private async sendToRelay(peerId: PeerId, envelope: RelayEnvelope): Promise<RelayAck> {
    // In production, this would send over libp2p
    // For now, simulate success

    return {
      envelopeId: envelope.envelopeId,
      status: 'accepted',
      relayedBy: peerId,
      timestamp: Date.now(),
    };
  }

  /**
   * Create a relay envelope from plaintext message
   */
  async createEnvelope(
    roomId: string,
    ciphertext: Uint8Array,
    proof: RelayProof
  ): Promise<RelayEnvelope> {
    const { padded, bucket } = padMessage(ciphertext);

    return {
      envelopeId: randomHex(16),
      roomId,
      ciphertext: padded,
      relayProof: proof,
      sizeBucket: bucket === 256 ? 'small' : bucket === 4096 ? 'medium' : 'large',
      timestamp: Date.now(),
      nonce: randomHex(16),
      ttl: 3,
    };
  }

  /**
   * Generate a relay proof for sending messages
   */
  async generateRelayProof(): Promise<RelayProof> {
    if (!this.peerId) {
      throw new Error('P2P service not initialized');
    }

    // Use PoW for now
    const pow = await generateProofOfWork(this.peerId, 16);

    return {
      type: 'pow',
      data: JSON.stringify(pow),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    };
  }

  /**
   * Shutdown the P2P network
   */
  async shutdown(): Promise<void> {
    // Disconnect from all peers
    for (const [peerId] of this.connections) {
      await this.disconnect(peerId);
    }

    this.peers.clear();
    this.committees.clear();
    console.log('[P2P] Shutdown complete');
  }

  /**
   * Disconnect from a peer
   */
  private async disconnect(peerId: PeerId): Promise<void> {
    const conn = this.connections.get(peerId);
    if (conn) {
      // In production, close libp2p connection
      this.connections.delete(peerId);
      this.emit({ type: 'peer_disconnected', peerId, reason: 'manual' });
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a P2P relay service instance
 */
export function createP2PRelayService(config: Partial<P2PConfig> = {}): P2PRelayService {
  const fullConfig: P2PConfig = {
    bootstrapNodes: config.bootstrapNodes || [],
    enableMdns: config.enableMdns ?? true,
    maxConnections: config.maxConnections ?? 50,
    committee: {
      committeeSize: config.committee?.committeeSize ?? 5,
      epochDuration: config.committee?.epochDuration ?? 600000,
      handoffOverlap: config.committee?.handoffOverlap ?? 120000,
      minPeersRequired: config.committee?.minPeersRequired ?? 3,
      hashAlgorithm: config.committee?.hashAlgorithm ?? 'sha256',
    },
    reputation: {
      minUptime: config.reputation?.minUptime ?? 80,
      minSuccessRate: config.reputation?.minSuccessRate ?? 95,
      maxLatencyP95: config.reputation?.maxLatencyP95 ?? 500,
      minForPremiumRooms: config.reputation?.minForPremiumRooms ?? 90,
    },
    coverTraffic: {
      enabled: config.coverTraffic?.enabled ?? true,
      intervalMs: config.coverTraffic?.intervalMs ?? 30000,
      jitterMs: config.coverTraffic?.jitterMs ?? 10000,
      sizeDistribution: config.coverTraffic?.sizeDistribution ?? {
        small: 0.6,
        medium: 0.35,
        large: 0.05,
      },
    },
    mixnet: {
      enabled: config.mixnet?.enabled ?? false,
      hopCount: config.mixnet?.hopCount ?? 3,
      maxHopLatency: config.mixnet?.maxHopLatency ?? 500,
      batchSize: config.mixnet?.batchSize ?? 10,
      batchTimeout: config.mixnet?.batchTimeout ?? 1000,
    },
    stunServers: config.stunServers ?? ['stun:stun.l.google.com:19302'],
    turnServers: config.turnServers ?? [],
    enableRelaying: config.enableRelaying ?? true,
    maxRelayBandwidth: config.maxRelayBandwidth ?? 1048576,
  };

  return new P2PRelayService(fullConfig);
}
