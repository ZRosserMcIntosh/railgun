/**
 * Hybrid Transport Types
 *
 * Defines types for the AWS-primary + P2P-fallback transport architecture.
 * This enables censorship-resistant communication where AWS handles normal
 * operations but the network seamlessly falls back to fully distributed
 * peer-to-peer routing if centralized infrastructure is unavailable.
 */

import type { PeerId, RelayEnvelope } from './p2p.types';

// ============================================================================
// Transport Mode & State
// ============================================================================

/** Transport mode priority order */
export type TransportMode = 'aws' | 'hybrid' | 'p2p-only';

/** Current transport state */
export type TransportState =
  | 'connected-aws'        // Normal operation via AWS
  | 'connected-hybrid'     // Using both AWS and P2P
  | 'connected-p2p'        // AWS unavailable, P2P only
  | 'degraded'             // Partial connectivity
  | 'connecting'           // Establishing connection
  | 'disconnected';        // No connectivity

/** Reason for transport switch */
export type TransportSwitchReason =
  | 'aws-unreachable'      // AWS endpoints not responding
  | 'aws-blocked'          // DNS/IP blocking detected
  | 'latency-threshold'    // AWS latency too high
  | 'manual'               // User requested P2P mode
  | 'policy'               // Geographic/legal policy
  | 'aws-restored'         // AWS became available again
  | 'load-balance';        // Hybrid mode for load distribution

// ============================================================================
// Device Capabilities
// ============================================================================

/** Device class for capacity allocation */
export type DeviceClass =
  | 'desktop-powerful'     // High-spec desktop (can relay heavily)
  | 'desktop-standard'     // Normal desktop
  | 'laptop-plugged'       // Laptop on power
  | 'laptop-battery'       // Laptop on battery (limited relay)
  | 'mobile-wifi'          // Phone/tablet on WiFi
  | 'mobile-cellular'      // Phone on cellular (minimal relay)
  | 'server';              // Dedicated relay server

/** Device capability advertisement */
export interface DeviceCapabilities {
  /** Device class */
  deviceClass: DeviceClass;

  /** Estimated upload bandwidth (bytes/sec) */
  uploadBandwidth: number;

  /** Estimated download bandwidth (bytes/sec) */
  downloadBandwidth: number;

  /** Maximum connections willing to relay */
  maxRelayConnections: number;

  /** Maximum relay bandwidth willing to provide (bytes/sec) */
  maxRelayBandwidth: number;

  /** Whether device can act as TURN relay */
  canActAsTurn: boolean;

  /** Whether device can persist messages for store-and-forward */
  canStoreMessages: boolean;

  /** Maximum storage for store-and-forward (bytes) */
  maxMessageStorage: number;

  /** Battery status (for mobile) */
  batteryStatus?: 'charging' | 'high' | 'medium' | 'low' | 'critical';

  /** NAT type */
  natType: 'open' | 'full-cone' | 'restricted' | 'port-restricted' | 'symmetric' | 'unknown';

  /** Supported transports */
  transports: ('websocket' | 'webrtc' | 'quic' | 'tcp' | 'tor' | 'i2p')[];

  /** Whether running Tor (for .onion reachability) */
  hasTor: boolean;

  /** Whether running I2P */
  hasI2P: boolean;

  /** Time-based availability (e.g., always on, business hours) */
  availability: 'always' | 'when-active' | 'scheduled';

  /** Scheduled availability windows (if applicable) */
  availabilitySchedule?: AvailabilityWindow[];
}

/** Time window for scheduled availability */
export interface AvailabilityWindow {
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  startHour: number; // 0-23
  endHour: number;   // 0-23
  timezone: string;  // IANA timezone
}

// ============================================================================
// Capacity-Aware Routing
// ============================================================================

/** Peer scoring for relay selection */
export interface PeerScore {
  peerId: PeerId;

  /** Base reputation score (0-100) */
  reputationScore: number;

  /** Recent relay performance score (0-100) */
  performanceScore: number;

  /** Available capacity score (0-100) */
  capacityScore: number;

  /** Geographic diversity score (0-100) */
  diversityScore: number;

  /** Combined weighted score */
  totalScore: number;

  /** Last updated timestamp */
  updatedAt: number;
}

/** Routing decision result */
export interface RoutingDecision {
  /** Selected primary relay path */
  primaryPath: PeerId[];

  /** Backup relay path */
  backupPath: PeerId[];

  /** Estimated latency (ms) */
  estimatedLatency: number;

  /** Estimated reliability (0-100) */
  estimatedReliability: number;

  /** Transport mode used */
  transportMode: TransportMode;

  /** Timestamp of decision */
  decidedAt: number;
}

// ============================================================================
// Store-and-Forward (Offline Message Delivery)
// ============================================================================

/** Message queued for offline delivery */
export interface QueuedMessage {
  /** Message envelope */
  envelope: RelayEnvelope;

  /** Target recipient peer ID */
  recipientPeerId: PeerId;

  /** When message was queued */
  queuedAt: number;

  /** Message TTL (expires after this) */
  expiresAt: number;

  /** Delivery attempts */
  attempts: number;

  /** Last delivery attempt */
  lastAttemptAt?: number;

  /** Storage nodes holding this message */
  storedBy: PeerId[];

  /** Redundancy target (k-replication) */
  redundancyTarget: number;

  /** Rendezvous keys for recipient polling */
  rendezvousKeys: string[];
}

/** Store-and-forward node status */
export interface StoreNodeStatus {
  peerId: PeerId;
  
  /** Current storage used (bytes) */
  storageUsed: number;

  /** Maximum storage capacity (bytes) */
  storageCapacity: number;

  /** Messages currently stored */
  messageCount: number;

  /** Average message age (ms) */
  averageMessageAge: number;

  /** Last garbage collection */
  lastGC: number;
}

// ============================================================================
// Hybrid Transport Configuration
// ============================================================================

/** Hybrid transport configuration */
export interface HybridTransportConfig {
  /** Preferred transport mode */
  preferredMode: TransportMode;

  /** AWS API endpoint */
  awsEndpoint: string;

  /** AWS WebSocket endpoint */
  awsWebsocketEndpoint: string;

  /** AWS health check interval (ms) */
  awsHealthCheckInterval: number;

  /** Latency threshold to trigger P2P fallback (ms) */
  awsLatencyThreshold: number;

  /** Number of consecutive failures before P2P fallback */
  awsFailureThreshold: number;

  /** Time to wait before attempting AWS reconnect (ms) */
  awsReconnectDelay: number;

  /** Whether to use P2P for additional redundancy even when AWS works */
  enableHybridRedundancy: boolean;

  /** P2P bootstrap nodes */
  bootstrapNodes: string[];

  /** DHT configuration */
  dht: {
    enabled: boolean;
    refreshInterval: number;
    maxPeers: number;
  };

  /** Store-and-forward configuration */
  storeAndForward: {
    enabled: boolean;
    defaultTTL: number;          // ms
    maxTTL: number;              // ms
    redundancyFactor: number;    // k-replication
    maxStoragePerPeer: number;   // bytes
    gcInterval: number;          // ms
  };

  /** Capacity sharing configuration */
  capacitySharing: {
    enabled: boolean;
    maxUploadShare: number;      // 0-1 (fraction of bandwidth)
    maxRelayConnections: number;
    prioritizeOwnMessages: boolean;
  };

  /** Cover traffic configuration */
  coverTraffic: {
    enabled: boolean;
    intervalMs: number;
    jitterMs: number;
  };
}

/** Default hybrid transport configuration */
export const DEFAULT_HYBRID_CONFIG: HybridTransportConfig = {
  preferredMode: 'aws',
  awsEndpoint: '',
  awsWebsocketEndpoint: '',
  awsHealthCheckInterval: 30000,
  awsLatencyThreshold: 2000,
  awsFailureThreshold: 3,
  awsReconnectDelay: 60000,
  enableHybridRedundancy: false,
  bootstrapNodes: [],
  dht: {
    enabled: true,
    refreshInterval: 300000,
    maxPeers: 100,
  },
  storeAndForward: {
    enabled: true,
    defaultTTL: 7 * 24 * 60 * 60 * 1000, // 7 days
    maxTTL: 30 * 24 * 60 * 60 * 1000,    // 30 days
    redundancyFactor: 3,
    maxStoragePerPeer: 100 * 1024 * 1024, // 100MB
    gcInterval: 60 * 60 * 1000,           // 1 hour
  },
  capacitySharing: {
    enabled: true,
    maxUploadShare: 0.5,
    maxRelayConnections: 20,
    prioritizeOwnMessages: true,
  },
  coverTraffic: {
    enabled: true,
    intervalMs: 30000,
    jitterMs: 10000,
  },
};

// ============================================================================
// Transport Events
// ============================================================================

/** Transport event types */
export type HybridTransportEventType =
  | 'transport-switched'
  | 'aws-health-changed'
  | 'peer-joined-relay'
  | 'peer-left-relay'
  | 'capacity-updated'
  | 'message-stored'
  | 'message-delivered'
  | 'message-expired'
  | 'routing-changed';

/** Transport event */
export interface HybridTransportEvent {
  type: HybridTransportEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

/** Transport switch event */
export interface TransportSwitchedEvent extends HybridTransportEvent {
  type: 'transport-switched';
  data: {
    previousState: TransportState;
    newState: TransportState;
    reason: TransportSwitchReason;
    peerCount?: number;
  };
}

/** AWS health change event */
export interface AWSHealthChangedEvent extends HybridTransportEvent {
  type: 'aws-health-changed';
  data: {
    healthy: boolean;
    latency?: number;
    errorCode?: string;
    consecutiveFailures: number;
  };
}

// ============================================================================
// DHT & Discovery Extensions
// ============================================================================

/** DHT key types for different lookups */
export type DHTKeyType =
  | 'peer'           // Peer presence
  | 'room'           // Room/channel membership
  | 'rendezvous'     // Store-and-forward rendezvous
  | 'capability'     // Capability advertisement
  | 'bootstrap';     // Bootstrap node announcement

/** DHT record with signature */
export interface SignedDHTRecord {
  /** Key type */
  keyType: DHTKeyType;

  /** Key value */
  key: string;

  /** Record data */
  data: Uint8Array;

  /** Signing peer ID */
  signerPeerId: PeerId;

  /** Ed25519 signature */
  signature: Uint8Array;

  /** Sequence number (for updates) */
  sequence: number;

  /** TTL in seconds */
  ttl: number;

  /** Creation timestamp */
  createdAt: number;
}

/** Rendezvous point for offline message retrieval */
export interface RendezvousPoint {
  /** Rendezvous key (derived from recipient identity) */
  key: string;

  /** Peer IDs holding messages */
  storageNodes: PeerId[];

  /** Number of pending messages */
  pendingCount: number;

  /** Oldest message timestamp */
  oldestMessage: number;

  /** Last check timestamp */
  lastChecked: number;
}

// ============================================================================
// Voice/Video P2P Extensions
// ============================================================================

/** P2P voice room configuration */
export interface P2PVoiceConfig {
  /** Maximum participants for mesh (beyond this, use SFU peers) */
  meshThreshold: number;

  /** Peer-hosted SFU configuration */
  sfuConfig: {
    enabled: boolean;
    minCapabilityScore: number;
    rotationInterval: number;
  };

  /** ICE configuration */
  ice: {
    stunServers: string[];
    turnServers: Array<{
      url: string;
      username?: string;
      credential?: string;
    }>;
    /** Peer-hosted TURN fallback */
    peerTurnEnabled: boolean;
  };
}

/** SFU host candidacy */
export interface SFUCandidacy {
  peerId: PeerId;
  capabilities: DeviceCapabilities;
  score: number;
  currentLoad: number;
  maxCapacity: number;
  region?: string;
}
