/**
 * Hybrid Transport Service
 *
 * AWS-primary + P2P-fallback transport layer that provides censorship-resistant
 * communication. When AWS is available, it handles all traffic for best performance.
 * When AWS becomes unreachable (government takedown, DNS blocking, etc.), the system
 * seamlessly transitions to a fully distributed P2P network.
 *
 * Architecture:
 * 1. Primary: AWS WebSocket/REST API
 * 2. Fallback: P2P overlay network with DHT discovery
 * 3. Hybrid: Optional redundancy using both for high-availability
 */

import type {
  HybridTransportConfig,
  TransportMode,
  TransportState,
  TransportSwitchReason,
  DeviceCapabilities,
  PeerScore,
  RoutingDecision,
  QueuedMessage,
  HybridTransportEvent,
} from '@railgun/shared';
import type { PeerId, RelayEnvelope, RelayAck } from '@railgun/shared';
import { DEFAULT_HYBRID_CONFIG } from '@railgun/shared';

// ============================================================================
// Types
// ============================================================================

type EventHandler = (event: HybridTransportEvent) => void;

interface AWSHealthStatus {
  healthy: boolean;
  lastCheck: number;
  latency: number;
  consecutiveFailures: number;
  errorCode?: string;
}

interface P2PNetworkStatus {
  connected: boolean;
  peerCount: number;
  dhtReady: boolean;
  relayCapacity: number;
}

// ============================================================================
// AWS Health Monitor
// ============================================================================

class AWSHealthMonitor {
  private status: AWSHealthStatus = {
    healthy: true,
    lastCheck: 0,
    latency: 0,
    consecutiveFailures: 0,
  };
  private checkInterval?: ReturnType<typeof setInterval>;
  private onHealthChange?: (status: AWSHealthStatus) => void;

  constructor(
    private endpoint: string,
    private intervalMs: number,
    private latencyThreshold: number,
    private failureThreshold: number
  ) {}

  start(onHealthChange: (status: AWSHealthStatus) => void): void {
    this.onHealthChange = onHealthChange;
    this.checkInterval = setInterval(() => this.check(), this.intervalMs);
    this.check(); // Immediate first check
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  getStatus(): AWSHealthStatus {
    return { ...this.status };
  }

  private async check(): Promise<void> {
    const startTime = Date.now();
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${this.endpoint}/health`, {
        signal: controller.signal,
        method: 'GET',
        cache: 'no-store',
      });

      clearTimeout(timeoutId);
      const latency = Date.now() - startTime;

      if (response.ok && latency < this.latencyThreshold) {
        this.status = {
          healthy: true,
          lastCheck: Date.now(),
          latency,
          consecutiveFailures: 0,
        };
      } else {
        this.handleFailure(
          response.ok ? 'high-latency' : `http-${response.status}`,
          latency
        );
      }
    } catch (error) {
      const errorCode = error instanceof Error
        ? (error.name === 'AbortError' ? 'timeout' : error.message)
        : 'unknown';
      this.handleFailure(errorCode, Date.now() - startTime);
    }

    this.onHealthChange?.(this.status);
  }

  private handleFailure(errorCode: string, latency: number): void {
    this.status.consecutiveFailures++;
    this.status.lastCheck = Date.now();
    this.status.latency = latency;
    this.status.errorCode = errorCode;

    if (this.status.consecutiveFailures >= this.failureThreshold) {
      this.status.healthy = false;
    }
  }

  /** Force immediate health check */
  async forceCheck(): Promise<AWSHealthStatus> {
    await this.check();
    return this.status;
  }
}

// ============================================================================
// Capacity Manager
// ============================================================================

class CapacityManager {
  private localCapabilities: DeviceCapabilities | null = null;
  private peerCapabilities: Map<PeerId, DeviceCapabilities> = new Map();
  private peerScores: Map<PeerId, PeerScore> = new Map();

  constructor(private config: HybridTransportConfig) {}

  /**
   * Detect and set local device capabilities
   */
  async detectLocalCapabilities(): Promise<DeviceCapabilities> {
    const capabilities: DeviceCapabilities = {
      deviceClass: await this.detectDeviceClass(),
      uploadBandwidth: await this.estimateBandwidth('upload'),
      downloadBandwidth: await this.estimateBandwidth('download'),
      maxRelayConnections: this.calculateMaxRelayConnections(),
      maxRelayBandwidth: this.calculateMaxRelayBandwidth(),
      canActAsTurn: await this.canActAsTurn(),
      canStoreMessages: this.canStoreMessages(),
      maxMessageStorage: this.calculateMaxStorage(),
      natType: await this.detectNATType(),
      transports: this.detectSupportedTransports(),
      hasTor: await this.detectTor(),
      hasI2P: await this.detectI2P(),
      availability: 'when-active',
    };

    // Add battery status for mobile
    if (capabilities.deviceClass.includes('mobile') || capabilities.deviceClass.includes('laptop')) {
      capabilities.batteryStatus = await this.getBatteryStatus();
    }

    this.localCapabilities = capabilities;
    return capabilities;
  }

  getLocalCapabilities(): DeviceCapabilities | null {
    return this.localCapabilities;
  }

  /**
   * Update peer capabilities from advertisement
   */
  updatePeerCapabilities(peerId: PeerId, capabilities: DeviceCapabilities): void {
    this.peerCapabilities.set(peerId, capabilities);
    this.updatePeerScore(peerId);
  }

  /**
   * Get peer capabilities
   */
  getPeerCapabilities(peerId: PeerId): DeviceCapabilities | undefined {
    return this.peerCapabilities.get(peerId);
  }

  /**
   * Calculate peer score based on capabilities and performance
   */
  private updatePeerScore(peerId: PeerId): void {
    const caps = this.peerCapabilities.get(peerId);
    if (!caps) return;

    const existing = this.peerScores.get(peerId);
    
    // Capacity score based on bandwidth and availability
    const bandwidthScore = Math.min(100, (caps.uploadBandwidth / 1000000) * 20); // 5Mbps = 100
    const availabilityScore = caps.availability === 'always' ? 100 : caps.availability === 'when-active' ? 70 : 50;
    const capacityScore = (bandwidthScore + availabilityScore) / 2;

    // Performance score (use existing or default)
    const performanceScore = existing?.performanceScore ?? 80;
    
    // Reputation score (use existing or default)
    const reputationScore = existing?.reputationScore ?? 50;

    // Diversity score (placeholder - would consider geography)
    const diversityScore = 50;

    const score: PeerScore = {
      peerId,
      reputationScore,
      performanceScore,
      capacityScore,
      diversityScore,
      totalScore: (reputationScore * 0.3 + performanceScore * 0.3 + capacityScore * 0.3 + diversityScore * 0.1),
      updatedAt: Date.now(),
    };

    this.peerScores.set(peerId, score);
  }

  /**
   * Get best peers for relay selection
   */
  getBestRelayPeers(count: number, exclude: PeerId[] = []): PeerId[] {
    return Array.from(this.peerScores.entries())
      .filter(([peerId]) => !exclude.includes(peerId))
      .sort((a, b) => b[1].totalScore - a[1].totalScore)
      .slice(0, count)
      .map(([peerId]) => peerId);
  }

  /**
   * Update peer performance score after relay
   */
  recordRelayPerformance(peerId: PeerId, success: boolean, latencyMs: number): void {
    const score = this.peerScores.get(peerId);
    if (!score) return;

    // Exponential moving average
    const alpha = 0.1;
    const successValue = success ? 100 : 0;
    const latencyValue = Math.max(0, 100 - (latencyMs / 10)); // 1000ms = 0, 0ms = 100

    score.performanceScore = score.performanceScore * (1 - alpha) + 
      ((successValue + latencyValue) / 2) * alpha;
    score.totalScore = (score.reputationScore * 0.3 + score.performanceScore * 0.3 + 
      score.capacityScore * 0.3 + score.diversityScore * 0.1);
    score.updatedAt = Date.now();
  }

  // Device detection helpers
  private async detectDeviceClass(): Promise<DeviceCapabilities['deviceClass']> {
    // Check if running in Electron (desktop)
    if (typeof window !== 'undefined' && 'electron' in window) {
      const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
      if (memory && memory >= 8) return 'desktop-powerful';
      return 'desktop-standard';
    }

    // Check for mobile
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    
    if (isMobile) {
      // Check connection type
      const conn = (navigator as Navigator & { connection?: { type?: string } }).connection;
      if (conn?.type === 'wifi') return 'mobile-wifi';
      return 'mobile-cellular';
    }

    // Default to laptop
    const battery = await this.getBatteryStatus();
    if (battery === 'charging') return 'laptop-plugged';
    return 'laptop-battery';
  }

  private async estimateBandwidth(_direction: 'upload' | 'download'): Promise<number> {
    // In production, would use Network Information API or actual speed test
    const conn = (navigator as Navigator & { connection?: { downlink?: number } }).connection;
    if (conn?.downlink) {
      return conn.downlink * 1000000 / 8; // Mbps to bytes/sec
    }
    return 1000000; // Default 1MB/s
  }

  private calculateMaxRelayConnections(): number {
    if (!this.localCapabilities) return 10;
    switch (this.localCapabilities.deviceClass) {
      case 'server': return 100;
      case 'desktop-powerful': return 50;
      case 'desktop-standard': return 30;
      case 'laptop-plugged': return 20;
      case 'laptop-battery': return 10;
      case 'mobile-wifi': return 5;
      case 'mobile-cellular': return 2;
      default: return 10;
    }
  }

  private calculateMaxRelayBandwidth(): number {
    if (!this.localCapabilities) return 500000;
    const share = this.config.capacitySharing.maxUploadShare;
    return Math.floor(this.localCapabilities.uploadBandwidth * share);
  }

  private async canActAsTurn(): Promise<boolean> {
    // Can act as TURN if we have open NAT and sufficient bandwidth
    const nat = await this.detectNATType();
    return nat === 'open' || nat === 'full-cone';
  }

  private canStoreMessages(): boolean {
    // Check if we have IndexedDB available
    return typeof indexedDB !== 'undefined';
  }

  private calculateMaxStorage(): number {
    // Use configured max or default
    return this.config.storeAndForward.maxStoragePerPeer;
  }

  private async detectNATType(): Promise<DeviceCapabilities['natType']> {
    // In production, would use STUN to detect NAT type
    // For now, assume restricted
    return 'restricted';
  }

  private detectSupportedTransports(): DeviceCapabilities['transports'] {
    const transports: DeviceCapabilities['transports'] = ['websocket'];
    
    if (typeof RTCPeerConnection !== 'undefined') {
      transports.push('webrtc');
    }
    
    return transports;
  }

  private async detectTor(): Promise<boolean> {
    // Check if Tor SOCKS proxy is available
    // In Electron, could check for Tor process or proxy
    return false;
  }

  private async detectI2P(): Promise<boolean> {
    // Check if I2P router is available
    return false;
  }

  private async getBatteryStatus(): Promise<DeviceCapabilities['batteryStatus']> {
    if (typeof navigator === 'undefined') return undefined;
    
    try {
      const battery = await (navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; level: number }> }).getBattery?.();
      if (!battery) return undefined;
      
      if (battery.charging) return 'charging';
      if (battery.level > 0.8) return 'high';
      if (battery.level > 0.5) return 'medium';
      if (battery.level > 0.2) return 'low';
      return 'critical';
    } catch {
      return undefined;
    }
  }
}

// ============================================================================
// Store-and-Forward Manager
// ============================================================================

class StoreAndForwardManager {
  private db: IDBDatabase | null = null;
  private readonly DB_NAME = 'railgun-store-forward';
  private readonly STORE_NAME = 'messages';

  constructor(private config: HybridTransportConfig['storeAndForward']) {}

  async initialize(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      console.warn('[StoreAndForward] IndexedDB not available');
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1);

      request.onerror = () => reject(request.error);
      
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'envelope.envelopeId' });
          store.createIndex('recipientPeerId', 'recipientPeerId', { unique: false });
          store.createIndex('expiresAt', 'expiresAt', { unique: false });
          store.createIndex('rendezvousKeys', 'rendezvousKeys', { multiEntry: true });
        }
      };
    });
  }

  /**
   * Store a message for later delivery
   */
  async storeMessage(message: QueuedMessage): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      
      const request = store.put(message);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get messages for a recipient
   */
  async getMessagesForRecipient(recipientPeerId: PeerId): Promise<QueuedMessage[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const index = store.index('recipientPeerId');
      
      const request = index.getAll(recipientPeerId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Get messages by rendezvous key
   */
  async getMessagesByRendezvous(rendezvousKey: string): Promise<QueuedMessage[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const index = store.index('rendezvousKeys');
      
      const request = index.getAll(rendezvousKey);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Delete a delivered message
   */
  async deleteMessage(envelopeId: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      
      const request = store.delete(envelopeId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Garbage collect expired messages
   */
  async garbageCollect(): Promise<number> {
    if (!this.db) return 0;

    const now = Date.now();
    let deletedCount = 0;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const index = store.index('expiresAt');
      
      const range = IDBKeyRange.upperBound(now);
      const request = index.openCursor(range);
      
      request.onerror = () => reject(request.error);
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          resolve(deletedCount);
        }
      };
    });
  }

  /**
   * Start periodic garbage collection
   */
  startGC(): ReturnType<typeof setInterval> {
    return setInterval(() => {
      this.garbageCollect().then((count) => {
        if (count > 0) {
          console.log(`[StoreAndForward] GC removed ${count} expired messages`);
        }
      });
    }, this.config.gcInterval);
  }
}

// ============================================================================
// Hybrid Transport Service
// ============================================================================

export class HybridTransportService {
  private config: HybridTransportConfig;
  private state: TransportState = 'disconnected';
  private awsMonitor: AWSHealthMonitor;
  private capacityManager: CapacityManager;
  private storeForward: StoreAndForwardManager;
  private p2pStatus: P2PNetworkStatus = {
    connected: false,
    peerCount: 0,
    dhtReady: false,
    relayCapacity: 0,
  };
  private eventHandlers: Set<EventHandler> = new Set();
  private gcInterval?: ReturnType<typeof setInterval>;
  private localPeerId: PeerId | null = null;

  // WebSocket connections
  private awsWebSocket: WebSocket | null = null;
  private p2pConnections: Map<PeerId, RTCPeerConnection> = new Map();

  constructor(config: Partial<HybridTransportConfig> = {}) {
    this.config = { ...DEFAULT_HYBRID_CONFIG, ...config };
    
    this.awsMonitor = new AWSHealthMonitor(
      this.config.awsEndpoint,
      this.config.awsHealthCheckInterval,
      this.config.awsLatencyThreshold,
      this.config.awsFailureThreshold
    );
    
    this.capacityManager = new CapacityManager(this.config);
    this.storeForward = new StoreAndForwardManager(this.config.storeAndForward);
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Initialize the hybrid transport
   */
  async initialize(): Promise<void> {
    console.log('[HybridTransport] Initializing...');
    this.setState('connecting');

    // Detect local capabilities
    await this.capacityManager.detectLocalCapabilities();
    console.log('[HybridTransport] Device capabilities detected:', 
      this.capacityManager.getLocalCapabilities()?.deviceClass);

    // Initialize store-and-forward
    if (this.config.storeAndForward.enabled) {
      await this.storeForward.initialize();
      this.gcInterval = this.storeForward.startGC();
    }

    // Start AWS health monitoring
    this.awsMonitor.start((status) => this.handleAWSHealthChange(status));

    // Try AWS connection first
    if (this.config.preferredMode !== 'p2p-only') {
      await this.connectToAWS();
    }

    // Initialize P2P layer (always, for fallback)
    await this.initializeP2P();

    console.log('[HybridTransport] Initialized, state:', this.state);
  }

  /**
   * Shutdown the transport
   */
  async shutdown(): Promise<void> {
    console.log('[HybridTransport] Shutting down...');

    // Stop health monitoring
    this.awsMonitor.stop();

    // Stop garbage collection
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
    }

    // Close AWS connection
    if (this.awsWebSocket) {
      this.awsWebSocket.close();
      this.awsWebSocket = null;
    }

    // Close P2P connections
    for (const conn of this.p2pConnections.values()) {
      conn.close();
    }
    this.p2pConnections.clear();

    this.setState('disconnected');
    console.log('[HybridTransport] Shutdown complete');
  }

  // ============================================================================
  // Transport Mode Management
  // ============================================================================

  /**
   * Get current transport state
   */
  getState(): TransportState {
    return this.state;
  }

  /**
   * Get current transport mode
   */
  getMode(): TransportMode {
    switch (this.state) {
      case 'connected-aws':
        return 'aws';
      case 'connected-hybrid':
        return 'hybrid';
      case 'connected-p2p':
        return 'p2p-only';
      default:
        return this.config.preferredMode;
    }
  }

  /**
   * Force switch to P2P mode
   */
  async forcePeerToPeer(): Promise<void> {
    console.log('[HybridTransport] Forcing P2P mode');
    
    if (this.awsWebSocket) {
      this.awsWebSocket.close();
      this.awsWebSocket = null;
    }

    await this.ensureP2PConnected();
    this.switchState('connected-p2p', 'manual');
  }

  /**
   * Try to restore AWS connection
   */
  async tryRestoreAWS(): Promise<boolean> {
    console.log('[HybridTransport] Attempting AWS restore');
    
    const health = await this.awsMonitor.forceCheck();
    if (!health.healthy) {
      console.log('[HybridTransport] AWS still unhealthy');
      return false;
    }

    await this.connectToAWS();
    return this.state === 'connected-aws' || this.state === 'connected-hybrid';
  }

  private setState(newState: TransportState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      console.log(`[HybridTransport] State: ${oldState} -> ${newState}`);
    }
  }

  private switchState(newState: TransportState, reason: TransportSwitchReason): void {
    const oldState = this.state;
    this.setState(newState);

    this.emit({
      type: 'transport-switched',
      timestamp: Date.now(),
      data: {
        previousState: oldState,
        newState,
        reason,
        peerCount: this.p2pStatus.peerCount,
      },
    });
  }

  // ============================================================================
  // AWS Connection
  // ============================================================================

  private async connectToAWS(): Promise<void> {
    if (!this.config.awsWebsocketEndpoint) {
      console.log('[HybridTransport] No AWS WebSocket endpoint configured');
      return;
    }

    return new Promise((resolve) => {
      try {
        this.awsWebSocket = new WebSocket(this.config.awsWebsocketEndpoint);

        this.awsWebSocket.onopen = () => {
          console.log('[HybridTransport] AWS WebSocket connected');
          
          if (this.p2pStatus.connected && this.config.enableHybridRedundancy) {
            this.switchState('connected-hybrid', 'aws-restored');
          } else {
            this.switchState('connected-aws', 'aws-restored');
          }
          resolve();
        };

        this.awsWebSocket.onclose = () => {
          console.log('[HybridTransport] AWS WebSocket closed');
          this.awsWebSocket = null;
          
          if (this.p2pStatus.connected) {
            this.switchState('connected-p2p', 'aws-unreachable');
          } else {
            this.switchState('degraded', 'aws-unreachable');
          }
        };

        this.awsWebSocket.onerror = (error) => {
          console.error('[HybridTransport] AWS WebSocket error:', error);
        };

        this.awsWebSocket.onmessage = (event) => {
          this.handleAWSMessage(event.data);
        };

        // Timeout for connection
        setTimeout(() => {
          if (this.awsWebSocket?.readyState !== WebSocket.OPEN) {
            console.log('[HybridTransport] AWS connection timeout');
            this.awsWebSocket?.close();
            resolve();
          }
        }, 10000);
      } catch (error) {
        console.error('[HybridTransport] Failed to connect to AWS:', error);
        resolve();
      }
    });
  }

  private handleAWSHealthChange(status: AWSHealthStatus): void {
    this.emit({
      type: 'aws-health-changed',
      timestamp: Date.now(),
      data: {
        healthy: status.healthy,
        latency: status.latency,
        errorCode: status.errorCode,
        consecutiveFailures: status.consecutiveFailures,
      },
    });

    if (!status.healthy && this.state === 'connected-aws') {
      // AWS became unhealthy, switch to P2P
      console.log('[HybridTransport] AWS unhealthy, switching to P2P');
      this.ensureP2PConnected().then(() => {
        if (this.p2pStatus.connected) {
          this.switchState('connected-p2p', 'aws-unreachable');
        } else {
          this.switchState('degraded', 'aws-unreachable');
        }
      });
    } else if (status.healthy && this.state === 'connected-p2p') {
      // AWS recovered, optionally switch back
      if (this.config.preferredMode === 'aws') {
        console.log('[HybridTransport] AWS recovered, switching back');
        this.connectToAWS();
      }
    }
  }

  private handleAWSMessage(_data: string): void {
    // Handle incoming AWS messages
    // This would parse and dispatch to appropriate handlers
  }

  // ============================================================================
  // P2P Layer
  // ============================================================================

  private async initializeP2P(): Promise<void> {
    console.log('[HybridTransport] Initializing P2P layer');
    
    // Generate local peer ID
    this.localPeerId = await this.generatePeerId();
    console.log('[HybridTransport] Local peer ID:', this.localPeerId);

    // Bootstrap P2P network
    await this.bootstrapP2P();
  }

  private async generatePeerId(): Promise<PeerId> {
    // Generate random peer ID (in production, derive from keypair)
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return 'peer-' + Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async bootstrapP2P(): Promise<void> {
    // In production, this would use the BootstrapService
    // For now, simulate P2P connection
    
    for (const node of this.config.bootstrapNodes) {
      await this.connectToPeer(node);
    }

    // Start DHT discovery
    if (this.config.dht.enabled) {
      await this.startDHT();
    }
  }

  private async connectToPeer(_multiaddr: string): Promise<void> {
    // In production, establish WebRTC connection
    // For now, simulate connection
    console.log('[HybridTransport] Connecting to peer...');
  }

  private async startDHT(): Promise<void> {
    // In production, start Kademlia DHT
    // For now, mark as ready
    this.p2pStatus.dhtReady = true;
    console.log('[HybridTransport] DHT started');
  }

  private async ensureP2PConnected(): Promise<void> {
    if (this.p2pStatus.connected) return;

    // Attempt bootstrap
    await this.bootstrapP2P();

    // Check if we have peers
    if (this.p2pConnections.size > 0 || this.p2pStatus.dhtReady) {
      this.p2pStatus.connected = true;
      this.p2pStatus.peerCount = this.p2pConnections.size;
    }
  }

  // ============================================================================
  // Message Sending
  // ============================================================================

  /**
   * Send a message through the hybrid transport
   */
  async sendMessage(envelope: RelayEnvelope): Promise<RelayAck[]> {
    const mode = this.getMode();
    
    switch (mode) {
      case 'aws':
        return this.sendViaAWS(envelope);
      
      case 'p2p-only':
        return this.sendViaP2P(envelope);
      
      case 'hybrid':
        // Send via both for redundancy
        const [awsAcks, p2pAcks] = await Promise.all([
          this.sendViaAWS(envelope).catch(() => []),
          this.sendViaP2P(envelope).catch(() => []),
        ]);
        return [...awsAcks, ...p2pAcks];
      
      default:
        throw new Error('Transport not connected');
    }
  }

  private async sendViaAWS(envelope: RelayEnvelope): Promise<RelayAck[]> {
    if (!this.awsWebSocket || this.awsWebSocket.readyState !== WebSocket.OPEN) {
      throw new Error('AWS not connected');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('AWS send timeout'));
      }, 10000);

      // In production, would have proper request/response matching
      this.awsWebSocket!.send(JSON.stringify({
        type: 'relay',
        envelope: {
          ...envelope,
          ciphertext: Array.from(envelope.ciphertext), // Serialize Uint8Array
        },
      }));

      // Simulate ACK for now
      clearTimeout(timeout);
      resolve([{
        envelopeId: envelope.envelopeId,
        status: 'accepted',
        relayedBy: 'aws',
        timestamp: Date.now(),
      }]);
    });
  }

  private async sendViaP2P(envelope: RelayEnvelope): Promise<RelayAck[]> {
    if (!this.p2pStatus.connected) {
      throw new Error('P2P not connected');
    }

    // Get routing decision
    const routing = await this.computeRouting(envelope.roomId);
    const acks: RelayAck[] = [];

    // Send to primary path
    for (const peerId of routing.primaryPath) {
      try {
        const ack = await this.sendToPeer(peerId, envelope);
        acks.push(ack);
        this.capacityManager.recordRelayPerformance(peerId, true, Date.now() - envelope.timestamp);
      } catch (error) {
        this.capacityManager.recordRelayPerformance(peerId, false, 0);
        console.error(`[HybridTransport] Failed to send to ${peerId}:`, error);
      }
    }

    // If no successful sends, try backup path
    if (acks.length === 0) {
      for (const peerId of routing.backupPath) {
        try {
          const ack = await this.sendToPeer(peerId, envelope);
          acks.push(ack);
          break; // One successful backup is enough
        } catch {
          // Continue to next backup
        }
      }
    }

    return acks;
  }

  private async computeRouting(_roomId: string): Promise<RoutingDecision> {
    // Get best peers for this room
    const primaryPeers = this.capacityManager.getBestRelayPeers(3);
    const backupPeers = this.capacityManager.getBestRelayPeers(2, primaryPeers);

    return {
      primaryPath: primaryPeers,
      backupPath: backupPeers,
      estimatedLatency: 100,
      estimatedReliability: 95,
      transportMode: this.getMode(),
      decidedAt: Date.now(),
    };
  }

  private async sendToPeer(peerId: PeerId, envelope: RelayEnvelope): Promise<RelayAck> {
    // In production, send via WebRTC data channel
    // For now, simulate success
    return {
      envelopeId: envelope.envelopeId,
      status: 'accepted',
      relayedBy: peerId,
      timestamp: Date.now(),
    };
  }

  // ============================================================================
  // Store-and-Forward
  // ============================================================================

  /**
   * Store a message for offline recipient
   */
  async storeForOfflineDelivery(
    envelope: RelayEnvelope,
    recipientPeerId: PeerId,
    rendezvousKeys: string[]
  ): Promise<void> {
    if (!this.config.storeAndForward.enabled) {
      throw new Error('Store-and-forward disabled');
    }

    const message: QueuedMessage = {
      envelope,
      recipientPeerId,
      queuedAt: Date.now(),
      expiresAt: Date.now() + this.config.storeAndForward.defaultTTL,
      attempts: 0,
      storedBy: [this.localPeerId!],
      redundancyTarget: this.config.storeAndForward.redundancyFactor,
      rendezvousKeys,
    };

    await this.storeForward.storeMessage(message);

    // Replicate to other peers for redundancy
    await this.replicateMessage(message);

    this.emit({
      type: 'message-stored',
      timestamp: Date.now(),
      data: {
        envelopeId: envelope.envelopeId,
        recipientPeerId,
        expiresAt: message.expiresAt,
      },
    });
  }

  private async replicateMessage(message: QueuedMessage): Promise<void> {
    const peersNeeded = message.redundancyTarget - message.storedBy.length;
    if (peersNeeded <= 0) return;

    const storagePeers = this.capacityManager.getBestRelayPeers(peersNeeded, message.storedBy);
    
    for (const peerId of storagePeers) {
      try {
        await this.sendStorageRequest(peerId, message);
        message.storedBy.push(peerId);
      } catch {
        // Continue to next peer
      }
    }
  }

  private async sendStorageRequest(_peerId: PeerId, _message: QueuedMessage): Promise<void> {
    // In production, send storage request via P2P
  }

  /**
   * Check for messages at rendezvous points
   */
  async checkRendezvous(rendezvousKeys: string[]): Promise<QueuedMessage[]> {
    const messages: QueuedMessage[] = [];
    
    for (const key of rendezvousKeys) {
      const found = await this.storeForward.getMessagesByRendezvous(key);
      messages.push(...found);
    }

    return messages;
  }

  // ============================================================================
  // Events
  // ============================================================================

  /**
   * Subscribe to transport events
   */
  on(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: HybridTransportEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[HybridTransport] Event handler error:', error);
      }
    }
  }

  // ============================================================================
  // Status
  // ============================================================================

  /**
   * Get network status summary
   */
  getNetworkStatus(): {
    state: TransportState;
    mode: TransportMode;
    awsHealthy: boolean;
    p2pConnected: boolean;
    peerCount: number;
    dhtReady: boolean;
  } {
    const awsStatus = this.awsMonitor.getStatus();
    
    return {
      state: this.state,
      mode: this.getMode(),
      awsHealthy: awsStatus.healthy,
      p2pConnected: this.p2pStatus.connected,
      peerCount: this.p2pStatus.peerCount,
      dhtReady: this.p2pStatus.dhtReady,
    };
  }

  /**
   * Get device capabilities
   */
  getCapabilities(): DeviceCapabilities | null {
    return this.capacityManager.getLocalCapabilities();
  }
}

// ============================================================================
// Factory
// ============================================================================

let instance: HybridTransportService | null = null;

/**
 * Get singleton hybrid transport instance
 */
export function getHybridTransport(config?: Partial<HybridTransportConfig>): HybridTransportService {
  if (!instance) {
    instance = new HybridTransportService(config);
  }
  return instance;
}

/**
 * Create new hybrid transport instance
 */
export function createHybridTransport(config?: Partial<HybridTransportConfig>): HybridTransportService {
  return new HybridTransportService(config);
}
