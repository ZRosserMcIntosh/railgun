/**
 * Rail Gun P2P Relay Types
 *
 * Type definitions for the decentralized peer-to-peer relay network.
 * This system enables user-hosted traffic sharing where each peer
 * handles a proportional share of network traffic.
 */

// ============================================================================
// Peer Identity & Discovery
// ============================================================================

/** Unique peer identifier (derived from public key) */
export type PeerId = string;

/** Multiaddress for peer connection (libp2p format) */
export type Multiaddr = string;

/** Peer information for discovery */
export interface PeerInfo {
  peerId: PeerId;
  publicKey: string;
  addresses: Multiaddr[];
  protocols: string[];
  lastSeen: number;
  latencyMs?: number;
}

/** Peer discovery result */
export interface DiscoveryResult {
  peers: PeerInfo[];
  source: 'dht' | 'mdns' | 'bootstrap' | 'manual';
  timestamp: number;
}

// ============================================================================
// Reputation System
// ============================================================================

/** Peer reputation scores */
export interface PeerReputation {
  peerId: PeerId;

  /** Uptime score (0-100), rolling 24h window */
  uptimeScore: number;

  /** Message relay success rate (0-100), last 1000 messages */
  relaySuccessRate: number;

  /** 95th percentile latency in milliseconds */
  latencyP95: number;

  /** Total messages relayed (lifetime) */
  totalRelayed: number;

  /** Optional economic stake (in smallest unit) */
  stakedAmount?: bigint;

  /** Whether peer is blacklisted */
  blacklisted: boolean;

  /** Reason for blacklist (if applicable) */
  blacklistReason?: string;

  /** Timestamp of last activity */
  lastSeen: number;

  /** First seen timestamp */
  firstSeen: number;
}

/** Reputation update event */
export interface ReputationUpdate {
  peerId: PeerId;
  field: keyof PeerReputation;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  timestamp: number;
}

/** Reputation thresholds for relay eligibility */
export interface ReputationThresholds {
  /** Minimum uptime to be relay eligible */
  minUptime: number;

  /** Minimum success rate to be relay eligible */
  minSuccessRate: number;

  /** Maximum latency to be relay eligible */
  maxLatencyP95: number;

  /** Minimum reputation for high-traffic rooms */
  minForPremiumRooms: number;
}

// ============================================================================
// Relay Committee
// ============================================================================

/** Committee of peers responsible for relaying a room's messages */
export interface RelayCommittee {
  /** Room/channel this committee serves */
  roomId: string;

  /** Epoch number (committees rotate each epoch) */
  epoch: number;

  /** Committee members (ordered by deterministic selection) */
  members: PeerId[];

  /** Committee size (typically 3-7) */
  size: number;

  /** When this committee became active */
  activeAt: number;

  /** When this committee expires */
  expiresAt: number;

  /** Seed used for deterministic selection */
  selectionSeed: string;
}

/** Committee selection parameters */
export interface CommitteeConfig {
  /** Number of peers per committee */
  committeeSize: number;

  /** Duration of each epoch in milliseconds */
  epochDuration: number;

  /** Overlap period for committee handoff */
  handoffOverlap: number;

  /** Minimum peers needed to form committee */
  minPeersRequired: number;

  /** Hash algorithm for seed generation */
  hashAlgorithm: 'sha256' | 'blake3';
}

/** Committee member role */
export interface CommitteeMembership {
  roomId: string;
  epoch: number;
  role: 'primary' | 'backup';
  assignedSlice: number; // Which slice of members this peer handles
  totalSlices: number;
}

// ============================================================================
// Message Relay
// ============================================================================

/** Encrypted envelope for relay (peers see only this) */
export interface RelayEnvelope {
  /** Unique envelope ID */
  envelopeId: string;

  /** Room/channel ID (for routing) */
  roomId: string;

  /** Encrypted payload (E2EE ciphertext) */
  ciphertext: Uint8Array;

  /** Sender's relay proof (proves right to send) */
  relayProof: RelayProof;

  /** Size bucket for padding validation */
  sizeBucket: 'small' | 'medium' | 'large';

  /** Timestamp (for replay protection) */
  timestamp: number;

  /** Nonce for replay protection */
  nonce: string;

  /** TTL in hops (decremented each relay) */
  ttl: number;
}

/** Proof that sender is authorized to relay */
export interface RelayProof {
  /** Type of proof */
  type: 'pow' | 'token' | 'stake' | 'reputation';

  /** Proof data */
  data: string;

  /** Expiration timestamp */
  expiresAt: number;
}

/** Proof of work for relay admission */
export interface ProofOfWork {
  /** Peer ID being admitted */
  peerId: PeerId;

  /** Timestamp of proof generation */
  timestamp: number;

  /** Nonce that satisfies difficulty */
  nonce: string;

  /** Required difficulty (leading zeros) */
  difficulty: number;

  /** Resulting hash */
  hash: string;
}

/** Relay acknowledgment */
export interface RelayAck {
  envelopeId: string;
  status: 'accepted' | 'rejected' | 'rate_limited';
  relayedBy: PeerId;
  timestamp: number;
  error?: string;
}

// ============================================================================
// Privacy Features
// ============================================================================

/** Message size buckets for padding */
export enum MessageSizeBucket {
  /** 256 bytes - reactions, typing indicators */
  SMALL = 256,

  /** 4KB - text messages */
  MEDIUM = 4096,

  /** 64KB - media metadata, small files */
  LARGE = 65536,
}

/** Cover traffic configuration */
export interface CoverTrafficConfig {
  /** Whether cover traffic is enabled */
  enabled: boolean;

  /** Average interval between cover messages (ms) */
  intervalMs: number;

  /** Jitter range (+/- ms) */
  jitterMs: number;

  /** Size distribution for cover messages */
  sizeDistribution: {
    small: number; // probability 0-1
    medium: number;
    large: number;
  };
}

/** Mixnet routing configuration */
export interface MixnetConfig {
  /** Whether mixnet routing is enabled */
  enabled: boolean;

  /** Number of hops (layers of encryption) */
  hopCount: number;

  /** Maximum latency per hop (ms) */
  maxHopLatency: number;

  /** Batch size for mixing */
  batchSize: number;

  /** Batch timeout (ms) */
  batchTimeout: number;
}

/** Layered encryption for mixnet routing */
export interface MixnetEnvelope {
  /** Current layer (decremented each hop) */
  layer: number;

  /** Total layers */
  totalLayers: number;

  /** Next hop address (encrypted to current node) */
  nextHop: string;

  /** Encrypted inner envelope */
  innerEnvelope: Uint8Array;

  /** Delay before forwarding (ms) */
  delayMs: number;
}

// ============================================================================
// Connection & Transport
// ============================================================================

/** P2P connection state */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  FAILED = 'failed',
}

/** Transport protocol */
export enum TransportProtocol {
  WEBRTC = 'webrtc',
  WEBSOCKET = 'websocket',
  QUIC = 'quic',
  TCP = 'tcp',
}

/** NAT traversal method */
export enum NatTraversal {
  DIRECT = 'direct',
  STUN = 'stun',
  TURN = 'turn',
  HOLE_PUNCH = 'hole_punch',
}

/** Connection to a peer */
export interface PeerConnection {
  peerId: PeerId;
  state: ConnectionState;
  transport: TransportProtocol;
  natTraversal: NatTraversal;
  localAddress: Multiaddr;
  remoteAddress: Multiaddr;
  establishedAt?: number;
  latencyMs?: number;
  bytesIn: number;
  bytesOut: number;
}

// ============================================================================
// Events
// ============================================================================

/** P2P network events */
export type P2PEvent =
  | { type: 'peer_discovered'; peer: PeerInfo }
  | { type: 'peer_connected'; connection: PeerConnection }
  | { type: 'peer_disconnected'; peerId: PeerId; reason: string }
  | { type: 'committee_formed'; committee: RelayCommittee }
  | { type: 'committee_rotated'; oldCommittee: RelayCommittee; newCommittee: RelayCommittee }
  | { type: 'message_relayed'; envelope: RelayEnvelope; relayedBy: PeerId }
  | { type: 'message_received'; envelope: RelayEnvelope }
  | { type: 'reputation_updated'; update: ReputationUpdate }
  | { type: 'relay_failed'; envelopeId: string; reason: string };

/** Event handler type */
export type P2PEventHandler = (event: P2PEvent) => void;

// ============================================================================
// Network Statistics
// ============================================================================

/** Network statistics */
export interface NetworkStats {
  /** Number of connected peers */
  connectedPeers: number;

  /** Number of known peers (from DHT) */
  knownPeers: number;

  /** Active relay committees */
  activeCommittees: number;

  /** Messages relayed in current session */
  messagesRelayed: number;

  /** Bytes relayed in current session */
  bytesRelayed: number;

  /** Current bandwidth usage (bytes/sec) */
  bandwidthIn: number;
  bandwidthOut: number;

  /** Average relay latency (ms) */
  avgRelayLatency: number;

  /** Network health score (0-100) */
  healthScore: number;
}

// ============================================================================
// Configuration
// ============================================================================

/** P2P network configuration */
export interface P2PConfig {
  /** Bootstrap nodes for initial discovery */
  bootstrapNodes: Multiaddr[];

  /** Enable local peer discovery (mDNS) */
  enableMdns: boolean;

  /** Maximum concurrent connections */
  maxConnections: number;

  /** Committee configuration */
  committee: CommitteeConfig;

  /** Reputation thresholds */
  reputation: ReputationThresholds;

  /** Cover traffic settings */
  coverTraffic: CoverTrafficConfig;

  /** Mixnet settings (high security mode) */
  mixnet: MixnetConfig;

  /** STUN servers for NAT traversal */
  stunServers: string[];

  /** TURN servers for relay fallback */
  turnServers: Array<{
    url: string;
    username?: string;
    credential?: string;
  }>;

  /** Enable relay participation */
  enableRelaying: boolean;

  /** Maximum bandwidth for relaying (bytes/sec) */
  maxRelayBandwidth: number;
}

/** Default P2P configuration */
export const DEFAULT_P2P_CONFIG: P2PConfig = {
  bootstrapNodes: [],
  enableMdns: true,
  maxConnections: 50,
  committee: {
    committeeSize: 5,
    epochDuration: 600000, // 10 minutes
    handoffOverlap: 120000, // 2 minutes
    minPeersRequired: 3,
    hashAlgorithm: 'sha256',
  },
  reputation: {
    minUptime: 80,
    minSuccessRate: 95,
    maxLatencyP95: 500,
    minForPremiumRooms: 90,
  },
  coverTraffic: {
    enabled: true,
    intervalMs: 30000,
    jitterMs: 10000,
    sizeDistribution: {
      small: 0.6,
      medium: 0.35,
      large: 0.05,
    },
  },
  mixnet: {
    enabled: false,
    hopCount: 3,
    maxHopLatency: 500,
    batchSize: 10,
    batchTimeout: 1000,
  },
  stunServers: ['stun:stun.l.google.com:19302'],
  turnServers: [],
  enableRelaying: true,
  maxRelayBandwidth: 1048576, // 1 MB/s
};
