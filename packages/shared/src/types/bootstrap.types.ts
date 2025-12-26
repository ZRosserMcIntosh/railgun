/**
 * Bootstrap & Discovery Types
 * 
 * Multi-transport bootstrap resolution for takedown-resistant peer discovery.
 * Supports: Direct IP, Tor .onion, I2P, IPFS, DNS seeds
 */

// =============================================================================
// Bootstrap Node Types
// =============================================================================

export interface BootstrapAddresses {
  /** Direct IPv4 addresses (host:port) */
  ipv4?: string[];
  
  /** Direct IPv6 addresses ([host]:port) */
  ipv6?: string[];
  
  /** DNS names (least resilient, but convenient) */
  dns?: string[];
  
  /** Tor v3 .onion addresses */
  onion?: string[];
  
  /** I2P b32 addresses */
  i2p?: string[];
  
  /** IPFS multiaddrs or gateway paths */
  ipfs?: string[];
  
  /** DNSLink records (_dnslink.domain.tld) */
  dnslink?: string[];
}

export interface BootstrapNode {
  /** libp2p peer ID (derived from public key) */
  peerId: string;
  
  /** Multiple transport addresses */
  addresses: BootstrapAddresses;
  
  /** Ed25519 public key (base64) */
  publicKey: string;
  
  /** Self-signature proving key ownership */
  signature: string;
  
  /** Geographic region hint */
  region?: string;
  
  /** Node capabilities */
  capabilities: BootstrapCapability[];
  
  /** When this node was added to the list */
  addedAt: number;
  
  /** Optional expiration */
  expiresAt?: number;
}

export type BootstrapCapability = 
  | 'relay'       // Can relay messages for others
  | 'turn'        // Provides TURN/STUN services
  | 'bootstrap'   // Provides peer discovery
  | 'archive'     // Stores historical data
  | 'update'      // Serves update manifests
  | 'config';     // Serves config manifests

export interface BootstrapList {
  /** Schema version */
  version: number;
  
  /** Last update timestamp (ISO) */
  updated: string;
  
  /** Bootstrap nodes */
  nodes: BootstrapNode[];
  
  /** DNS SRV records for peer discovery */
  dnsSeeds: string[];
  
  /** IPFS/IPNS paths to fetch updated lists */
  ipfsManifests: string[];
  
  /** Signature by online signing key */
  signature: string;
  
  /** Which key signed this */
  signingKeyId: string;
}

// =============================================================================
// Peer Cache Types
// =============================================================================

export interface CachedPeer {
  /** Peer ID */
  peerId: string;
  
  /** Known addresses */
  addresses: string[];
  
  /** Last successful connection */
  lastSeen: number;
  
  /** Connection success rate (0-1) */
  reliability: number;
  
  /** Average latency in ms */
  latency: number;
  
  /** Capabilities advertised */
  capabilities: BootstrapCapability[];
}

export interface PeerCache {
  /** Cache version for migrations */
  version: number;
  
  /** When cache was last updated */
  updatedAt: number;
  
  /** Cached peers */
  peers: CachedPeer[];
  
  /** Bootstrap list version used */
  bootstrapVersion: number;
}

// =============================================================================
// Discovery Events
// =============================================================================

export type DiscoveryEventType =
  | 'bootstrap_start'
  | 'transport_attempt'
  | 'transport_success'
  | 'transport_failure'
  | 'peer_discovered'
  | 'peer_connected'
  | 'peer_disconnected'
  | 'cache_loaded'
  | 'cache_updated'
  | 'dht_ready';

export interface DiscoveryEvent {
  type: DiscoveryEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

// =============================================================================
// Bootstrap Resolution Config
// =============================================================================

export interface BootstrapConfig {
  /** Maximum time to wait for bootstrap (ms) */
  timeout: number;
  
  /** Minimum peers needed before considering bootstrap complete */
  minPeers: number;
  
  /** Maximum peers to maintain */
  maxPeers: number;
  
  /** How often to refresh peer cache (ms) */
  cacheRefreshInterval: number;
  
  /** Cache TTL (ms) */
  cacheTTL: number;
  
  /** Enable Tor transport */
  enableTor: boolean;
  
  /** Enable I2P transport */
  enableI2P: boolean;
  
  /** Parallel connection attempts per transport */
  parallelAttempts: number;
  
  /** Connection timeout per peer (ms) */
  peerTimeout: number;
}

export const DEFAULT_BOOTSTRAP_CONFIG: BootstrapConfig = {
  timeout: 30000,
  minPeers: 3,
  maxPeers: 50,
  cacheRefreshInterval: 3600000, // 1 hour
  cacheTTL: 86400000, // 24 hours
  enableTor: true,
  enableI2P: false, // Disabled by default (requires setup)
  parallelAttempts: 5,
  peerTimeout: 10000,
};
