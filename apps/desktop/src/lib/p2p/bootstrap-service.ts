/* eslint-disable no-console */
/**
 * Bootstrap Service
 * 
 * Multi-transport peer discovery with caching and resilience.
 * Tries all transport methods in parallel and caches discovered peers.
 */

import type {
  BootstrapList,
  BootstrapConfig,
  CachedPeer,
  PeerCache,
  DiscoveryEvent,
  BootstrapCapability,
} from '@railgun/shared';
import { DEFAULT_BOOTSTRAP_CONFIG } from '@railgun/shared';

// =============================================================================
// Hardcoded Bootstrap List (Embedded in Client)
// =============================================================================

/**
 * This list is embedded at build time and provides initial peer discovery.
 * It should contain nodes across multiple transports for resilience.
 * 
 * In production, replace with real bootstrap nodes.
 */
const HARDCODED_BOOTSTRAP: BootstrapList = {
  version: 1,
  updated: '2025-12-26T00:00:00Z',
  nodes: [
    // Example bootstrap nodes - replace with real ones in production
    {
      peerId: '12D3KooWExample1...',
      addresses: {
        ipv4: ['203.0.113.50:9000'],
        onion: ['exampleonionaddress1234567890abcdef.onion:9000'],
      },
      publicKey: 'MCowBQYDK2VwAyEAexamplekey1...',
      signature: 'examplesig1...',
      capabilities: ['relay', 'bootstrap', 'turn'],
      addedAt: Date.now(),
    },
    // Add more bootstrap nodes here
  ],
  dnsSeeds: [
    '_railgun-peers._tcp.bootstrap1.example.com',
    '_railgun-peers._tcp.bootstrap2.example.org',
  ],
  ipfsManifests: [
    '/ipns/k51qzi5uqu5dexample.../bootstrap',
  ],
  signature: 'manifest-signature...',
  signingKeyId: 'online-key-1',
};

// =============================================================================
// Transport Connectors
// =============================================================================

type TransportType = 'ipv4' | 'ipv6' | 'dns' | 'onion' | 'i2p' | 'ipfs';

interface TransportResult {
  transport: TransportType;
  success: boolean;
  peerId?: string;
  address?: string;
  latency?: number;
  error?: string;
}

/**
 * Attempt connection via direct IPv4
 */
async function connectIPv4(address: string, timeout: number): Promise<TransportResult> {
  const start = Date.now();
  try {
    // In real implementation, this would use libp2p or WebSocket
    // For now, simulate with fetch to a WebSocket upgrade endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // This is a placeholder - real implementation would establish libp2p connection
    const [host, port] = address.split(':');
    
    // Simulate connection attempt
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://${host}:${port}/p2p`);
      socket.onopen = () => {
        socket.close();
        resolve(true);
      };
      socket.onerror = reject;
      setTimeout(() => reject(new Error('Timeout')), timeout);
    });
    
    clearTimeout(timeoutId);
    
    return {
      transport: 'ipv4',
      success: true,
      address,
      latency: Date.now() - start,
    };
  } catch (error) {
    return {
      transport: 'ipv4',
      success: false,
      address,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Attempt connection via Tor .onion address
 * Requires Tor SOCKS proxy running locally
 * @param address - .onion address
 * @param _timeout - Connection timeout (reserved for real implementation)
 * @param socksProxy - SOCKS5 proxy address
 */
async function connectOnion(
  address: string, 
  _timeout: number,
  socksProxy: string = 'socks5://127.0.0.1:9050'
): Promise<TransportResult> {
  const start = Date.now();
  try {
    // In real implementation, this would route through Tor SOCKS proxy
    // Using a library like socks-proxy-agent
    
    // Placeholder - would use Tor-enabled WebSocket
    console.log(`[Tor] Attempting connection to ${address} via ${socksProxy}`);
    
    // Simulate Tor connection (slower)
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
    
    return {
      transport: 'onion',
      success: true,
      address,
      latency: Date.now() - start,
    };
  } catch (error) {
    return {
      transport: 'onion',
      success: false,
      address,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Attempt connection via I2P
 * Requires I2P router running locally
 * @param address - I2P b32 address
 * @param _timeout - Connection timeout (reserved for real implementation)
 * @param i2pProxy - I2P HTTP proxy address
 */
async function connectI2P(
  address: string,
  _timeout: number,
  i2pProxy: string = 'http://127.0.0.1:4444'
): Promise<TransportResult> {
  const start = Date.now();
  try {
    // In real implementation, this would route through I2P HTTP proxy
    console.log(`[I2P] Attempting connection to ${address} via ${i2pProxy}`);
    
    // Simulate I2P connection (even slower)
    await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 2000));
    
    return {
      transport: 'i2p',
      success: true,
      address,
      latency: Date.now() - start,
    };
  } catch (error) {
    return {
      transport: 'i2p',
      success: false,
      address,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Fetch bootstrap list from IPFS
 */
async function fetchFromIPFS(
  cid: string,
  timeout: number,
  gateways: string[] = [
    'https://ipfs.io/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://gateway.pinata.cloud/ipfs/',
    'https://dweb.link/ipfs/',
  ]
): Promise<BootstrapList | null> {
  // Try multiple gateways in parallel
  const attempts = gateways.map(async (gateway) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const url = cid.startsWith('/ipfs/') 
        ? `${gateway}${cid.slice(6)}`
        : cid.startsWith('/ipns/')
          ? `${gateway.replace('/ipfs/', '/ipns/')}${cid.slice(6)}`
          : `${gateway}${cid}`;
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      return await response.json() as BootstrapList;
    } catch {
      return null;
    }
  });
  
  // Return first successful result
  const results = await Promise.allSettled(attempts);
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      return result.value;
    }
  }
  
  return null;
}

/**
 * Resolve DNS SRV records for peer discovery
 * Reserved for future implementation with DNS-over-HTTPS
 * @param _seeds - DNS seed records (not used in browser - placeholder)
 */
export async function resolveDNSSeeds(_seeds: string[]): Promise<string[]> {
  const addresses: string[] = [];
  
  // In browser, we can't do DNS SRV lookups directly
  // Would need a DNS-over-HTTPS resolver or backend service
  // For now, return empty (DNS is least resilient anyway)
  
  console.log('[DNS] DNS seed resolution not available in browser');
  
  return addresses;
}

// =============================================================================
// Bootstrap Service
// =============================================================================

export class BootstrapService {
  private config: BootstrapConfig;
  private cache: PeerCache | null = null;
  private connectedPeers: Map<string, CachedPeer> = new Map();
  private eventListeners: Set<(event: DiscoveryEvent) => void> = new Set();
  private bootstrapInProgress = false;
  
  constructor(config: Partial<BootstrapConfig> = {}) {
    this.config = { ...DEFAULT_BOOTSTRAP_CONFIG, ...config };
  }
  
  /**
   * Subscribe to discovery events
   */
  onEvent(listener: (event: DiscoveryEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }
  
  private emit(type: DiscoveryEvent['type'], data: Record<string, unknown> = {}): void {
    const event: DiscoveryEvent = {
      type,
      timestamp: Date.now(),
      data,
    };
    this.eventListeners.forEach(listener => listener(event));
  }
  
  /**
   * Load peer cache from storage
   */
  async loadCache(): Promise<void> {
    try {
      const stored = localStorage.getItem('railgun:peer-cache');
      if (stored) {
        const cache = JSON.parse(stored) as PeerCache;
        
        // Check if cache is still valid
        if (Date.now() - cache.updatedAt < this.config.cacheTTL) {
          this.cache = cache;
          this.emit('cache_loaded', { peerCount: cache.peers.length });
        }
      }
    } catch (error) {
      console.warn('[Bootstrap] Failed to load peer cache:', error);
    }
  }
  
  /**
   * Save peer cache to storage
   */
  private async saveCache(): Promise<void> {
    if (!this.cache) return;
    
    try {
      localStorage.setItem('railgun:peer-cache', JSON.stringify(this.cache));
      this.emit('cache_updated', { peerCount: this.cache.peers.length });
    } catch (error) {
      console.warn('[Bootstrap] Failed to save peer cache:', error);
    }
  }
  
  /**
   * Update cache with discovered peer
   */
  private updatePeerCache(peer: CachedPeer): void {
    if (!this.cache) {
      this.cache = {
        version: 1,
        updatedAt: Date.now(),
        peers: [],
        bootstrapVersion: HARDCODED_BOOTSTRAP.version,
      };
    }
    
    const existingIndex = this.cache.peers.findIndex(p => p.peerId === peer.peerId);
    if (existingIndex >= 0) {
      // Update existing peer
      this.cache.peers[existingIndex] = {
        ...this.cache.peers[existingIndex],
        ...peer,
        reliability: (this.cache.peers[existingIndex].reliability + 1) / 2, // Moving average
      };
    } else {
      // Add new peer
      this.cache.peers.push(peer);
    }
    
    // Limit cache size
    if (this.cache.peers.length > this.config.maxPeers * 2) {
      // Sort by reliability and recency, keep best
      this.cache.peers.sort((a, b) => {
        const scoreA = a.reliability * 0.7 + (a.lastSeen / Date.now()) * 0.3;
        const scoreB = b.reliability * 0.7 + (b.lastSeen / Date.now()) * 0.3;
        return scoreB - scoreA;
      });
      this.cache.peers = this.cache.peers.slice(0, this.config.maxPeers * 2);
    }
    
    this.cache.updatedAt = Date.now();
  }
  
  /**
   * Main bootstrap procedure
   * Tries all transports in parallel, connects to minPeers before returning
   */
  async bootstrap(): Promise<void> {
    if (this.bootstrapInProgress) {
      console.log('[Bootstrap] Already in progress');
      return;
    }
    
    this.bootstrapInProgress = true;
    this.emit('bootstrap_start');
    
    try {
      // Load cached peers first
      await this.loadCache();
      
      // Collect all connection attempts
      const attempts: Promise<TransportResult>[] = [];
      
      // Try cached peers first (fastest)
      if (this.cache && this.cache.peers.length > 0) {
        const cachedPeers = this.cache.peers
          .sort((a, b) => b.reliability - a.reliability)
          .slice(0, this.config.parallelAttempts);
        
        for (const peer of cachedPeers) {
          for (const addr of peer.addresses) {
            attempts.push(this.tryConnect(addr));
          }
        }
      }
      
      // Try hardcoded bootstrap nodes
      for (const node of HARDCODED_BOOTSTRAP.nodes) {
        // IPv4
        if (node.addresses.ipv4) {
          for (const addr of node.addresses.ipv4) {
            this.emit('transport_attempt', { transport: 'ipv4', address: addr });
            attempts.push(connectIPv4(addr, this.config.peerTimeout));
          }
        }
        
        // Tor .onion
        if (this.config.enableTor && node.addresses.onion) {
          for (const addr of node.addresses.onion) {
            this.emit('transport_attempt', { transport: 'onion', address: addr });
            attempts.push(connectOnion(addr, this.config.peerTimeout));
          }
        }
        
        // I2P
        if (this.config.enableI2P && node.addresses.i2p) {
          for (const addr of node.addresses.i2p) {
            this.emit('transport_attempt', { transport: 'i2p', address: addr });
            attempts.push(connectI2P(addr, this.config.peerTimeout));
          }
        }
      }
      
      // Try IPFS manifests for updated bootstrap list
      for (const manifest of HARDCODED_BOOTSTRAP.ipfsManifests) {
        fetchFromIPFS(manifest, this.config.peerTimeout).then(list => {
          if (list && list.version > HARDCODED_BOOTSTRAP.version) {
            // TODO: Verify signature and update bootstrap list
            console.log('[Bootstrap] Found newer bootstrap list via IPFS');
          }
        });
      }
      
      // Wait for connections with timeout
      const timeout = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Bootstrap timeout')), this.config.timeout)
      );
      
      // Process results as they come in
      let connectedCount = 0;
      const processResults = async () => {
        for (const attempt of attempts) {
          try {
            const result = await Promise.race([attempt, timeout]);
            
            if (result.success) {
              this.emit('transport_success', { 
                transport: result.transport, 
                address: result.address,
                latency: result.latency,
              });
              
              // Update cache
              if (result.peerId) {
                this.updatePeerCache({
                  peerId: result.peerId,
                  addresses: [result.address!],
                  lastSeen: Date.now(),
                  reliability: 1,
                  latency: result.latency || 0,
                  capabilities: ['relay'],
                });
                
                this.connectedPeers.set(result.peerId, {
                  peerId: result.peerId,
                  addresses: [result.address!],
                  lastSeen: Date.now(),
                  reliability: 1,
                  latency: result.latency || 0,
                  capabilities: ['relay'],
                });
                
                connectedCount++;
                this.emit('peer_connected', { peerId: result.peerId, count: connectedCount });
                
                if (connectedCount >= this.config.minPeers) {
                  return; // We have enough peers
                }
              }
            } else {
              this.emit('transport_failure', { 
                transport: result.transport, 
                address: result.address,
                error: result.error,
              });
            }
          } catch (error) {
            // Individual attempt failed, continue with others
          }
        }
      };
      
      await Promise.race([processResults(), timeout]).catch(() => {
        console.warn('[Bootstrap] Timeout reached');
      });
      
      // Save updated cache
      await this.saveCache();
      
      if (connectedCount === 0) {
        throw new Error('Failed to connect to any bootstrap peers');
      }
      
      console.log(`[Bootstrap] Connected to ${connectedCount} peers`);
      this.emit('dht_ready', { peerCount: connectedCount });
      
    } finally {
      this.bootstrapInProgress = false;
    }
  }
  
  /**
   * Generic connection attempt (auto-detect transport)
   */
  private async tryConnect(address: string): Promise<TransportResult> {
    if (address.includes('.onion')) {
      return connectOnion(address, this.config.peerTimeout);
    } else if (address.includes('.i2p')) {
      return connectI2P(address, this.config.peerTimeout);
    } else {
      return connectIPv4(address, this.config.peerTimeout);
    }
  }
  
  /**
   * Get currently connected peers
   */
  getConnectedPeers(): CachedPeer[] {
    return Array.from(this.connectedPeers.values());
  }
  
  /**
   * Get peers with specific capability
   */
  getPeersWithCapability(capability: BootstrapCapability): CachedPeer[] {
    return Array.from(this.connectedPeers.values())
      .filter(peer => peer.capabilities.includes(capability));
  }
  
  /**
   * Peer-assisted discovery: ask connected peers for their peer lists
   */
  async discoverFromPeers(): Promise<void> {
    // TODO: Implement peer exchange protocol
    // This would ask connected peers for their known peers
    // and merge into our cache (after verification)
  }
  
  /**
   * Refresh peer connections
   */
  async refresh(): Promise<void> {
    // Remove stale connections
    const now = Date.now();
    for (const [peerId, peer] of this.connectedPeers) {
      if (now - peer.lastSeen > this.config.cacheRefreshInterval) {
        this.connectedPeers.delete(peerId);
        this.emit('peer_disconnected', { peerId });
      }
    }
    
    // Reconnect if needed
    if (this.connectedPeers.size < this.config.minPeers) {
      await this.bootstrap();
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let bootstrapService: BootstrapService | null = null;

export function getBootstrapService(config?: Partial<BootstrapConfig>): BootstrapService {
  if (!bootstrapService) {
    bootstrapService = new BootstrapService(config);
  }
  return bootstrapService;
}

export default BootstrapService;
