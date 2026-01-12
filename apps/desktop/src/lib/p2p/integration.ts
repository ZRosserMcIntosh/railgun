/* eslint-disable no-console */
/**
 * Hybrid Transport Integration
 *
 * This module demonstrates how to integrate the hybrid transport layer
 * into the Rail Gun application. It provides a high-level API that
 * abstracts the complexity of AWS vs P2P routing.
 */

import {
  createHybridTransport,
  getP2PVoice,
  initializeDHT,
  HybridTransportService,
  P2PVoiceService,
  DHTService,
} from './index';
import type {
  HybridTransportConfig,
  DeviceCapabilities,
  TransportState,
  HybridTransportEvent,
} from '@railgun/shared';
import type { PeerId, RelayEnvelope, RelayAck } from '@railgun/shared';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Production configuration
 */
const PRODUCTION_CONFIG: Partial<HybridTransportConfig> = {
  preferredMode: 'aws',
  awsEndpoint: (typeof import.meta !== 'undefined' ? (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL : undefined) || 'https://api.railgun.app',
  awsWebsocketEndpoint: (typeof import.meta !== 'undefined' ? (import.meta as { env?: Record<string, string> }).env?.VITE_WS_URL : undefined) || 'wss://ws.railgun.app/ws',
  awsHealthCheckInterval: 30000,
  awsLatencyThreshold: 2000,
  awsFailureThreshold: 3,
  awsReconnectDelay: 60000,
  enableHybridRedundancy: false,
  bootstrapNodes: [
    // Production bootstrap nodes would be listed here
    // '/ip4/203.0.113.50/tcp/9000/p2p/12D3KooW...',
  ],
  dht: {
    enabled: true,
    refreshInterval: 300000, // 5 minutes
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
// Integration Service
// ============================================================================

export class RailGunTransportIntegration {
  private transport: HybridTransportService | null = null;
  private voice: P2PVoiceService | null = null;
  private dht: DHTService | null = null;
  private localPeerId: PeerId | null = null;
  private localCapabilities: DeviceCapabilities | null = null;
  private initialized = false;

  /**
   * Initialize the transport integration
   */
  async initialize(config: Partial<HybridTransportConfig> = {}): Promise<void> {
    if (this.initialized) {
      console.warn('[Integration] Already initialized');
      return;
    }

    console.log('[Integration] Initializing transport layer...');

    // Merge with production config
    const fullConfig = { ...PRODUCTION_CONFIG, ...config };

    // Create transport service
    this.transport = createHybridTransport(fullConfig);
    
    // Initialize transport (this detects capabilities and starts health monitoring)
    await this.transport.initialize();
    
    // Get local info
    this.localCapabilities = this.transport.getCapabilities();
    this.localPeerId = `peer-${crypto.randomUUID().replace(/-/g, '').slice(0, 32)}`;

    // Initialize DHT
    this.dht = initializeDHT({
      localPeerId: this.localPeerId,
      localPublicKey: '', // Would come from crypto module
      localPrivateKey: new Uint8Array(32), // Would come from crypto module
      refreshInterval: fullConfig.dht?.refreshInterval || 300000,
      republishInterval: 3600000, // 1 hour
      expirationInterval: 60000, // 1 minute
      maxRecords: 10000,
      sendMessage: async (_peerId, _message) => {
        // In production, send via transport
        return null;
      },
    });
    await this.dht.start();

    // Initialize voice service
    this.voice = getP2PVoice();
    if (this.localCapabilities) {
      await this.voice.initialize(this.localPeerId, this.localCapabilities);
    }

    // Subscribe to transport events
    this.transport.on((event) => this.handleTransportEvent(event));

    this.initialized = true;
    console.log('[Integration] Transport layer initialized');
    console.log('[Integration] State:', this.transport.getState());
    console.log('[Integration] Mode:', this.transport.getMode());
    console.log('[Integration] Device class:', this.localCapabilities?.deviceClass);
  }

  /**
   * Shutdown the transport integration
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    console.log('[Integration] Shutting down...');

    if (this.voice) {
      await this.voice.shutdown();
      this.voice = null;
    }

    if (this.dht) {
      this.dht.stop();
      this.dht = null;
    }

    if (this.transport) {
      await this.transport.shutdown();
      this.transport = null;
    }

    this.initialized = false;
    console.log('[Integration] Shutdown complete');
  }

  // ============================================================================
  // Messaging
  // ============================================================================

  /**
   * Send an encrypted message
   */
  async sendMessage(
    roomId: string,
    ciphertext: Uint8Array,
  ): Promise<RelayAck[]> {
    if (!this.transport) {
      throw new Error('Transport not initialized');
    }

    // Create envelope
    const envelope: RelayEnvelope = {
      envelopeId: crypto.randomUUID(),
      roomId,
      ciphertext,
      relayProof: {
        type: 'pow',
        data: '{}', // Would generate real PoW
        expiresAt: Date.now() + 5 * 60 * 1000,
      },
      sizeBucket: ciphertext.length <= 256 ? 'small' : 
                  ciphertext.length <= 4096 ? 'medium' : 'large',
      timestamp: Date.now(),
      nonce: crypto.randomUUID(),
      ttl: 3,
    };

    // Send via hybrid transport
    return this.transport.sendMessage(envelope);
  }

  /**
   * Send message for offline recipient (store-and-forward)
   */
  async sendOfflineMessage(
    roomId: string,
    recipientPeerId: PeerId,
    ciphertext: Uint8Array,
  ): Promise<void> {
    if (!this.transport) {
      throw new Error('Transport not initialized');
    }

    const envelope: RelayEnvelope = {
      envelopeId: crypto.randomUUID(),
      roomId,
      ciphertext,
      relayProof: {
        type: 'pow',
        data: '{}',
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      },
      sizeBucket: ciphertext.length <= 256 ? 'small' : 
                  ciphertext.length <= 4096 ? 'medium' : 'large',
      timestamp: Date.now(),
      nonce: crypto.randomUUID(),
      ttl: 3,
    };

    // Generate rendezvous keys for recipient to find message
    const rendezvousKeys = [
      `inbox:${recipientPeerId}`,
      `room:${roomId}:${recipientPeerId}`,
    ];

    await this.transport.storeForOfflineDelivery(envelope, recipientPeerId, rendezvousKeys);
  }

  /**
   * Check for offline messages
   */
  async checkOfflineMessages(): Promise<RelayEnvelope[]> {
    if (!this.transport || !this.localPeerId) {
      return [];
    }

    const rendezvousKeys = [
      `inbox:${this.localPeerId}`,
    ];

    const messages = await this.transport.checkRendezvous(rendezvousKeys);
    return messages.map(m => m.envelope);
  }

  // ============================================================================
  // Voice/Video
  // ============================================================================

  /**
   * Join a voice room
   */
  async joinVoiceRoom(
    roomId: string,
    options: { audio?: boolean; video?: boolean } = { audio: true, video: false }
  ): Promise<void> {
    if (!this.voice) {
      throw new Error('Voice not initialized');
    }

    await this.voice.joinRoom(roomId, {
      audio: options.audio ?? true,
      video: options.video ?? false,
    });
  }

  /**
   * Leave a voice room
   */
  async leaveVoiceRoom(roomId: string): Promise<void> {
    if (!this.voice) return;
    await this.voice.leaveRoom(roomId);
  }

  /**
   * Set audio enabled
   */
  setAudioEnabled(enabled: boolean): void {
    this.voice?.setAudioEnabled(enabled);
  }

  /**
   * Set video enabled
   */
  setVideoEnabled(enabled: boolean): void {
    this.voice?.setVideoEnabled(enabled);
  }

  /**
   * Get voice room status
   */
  getVoiceRoomStatus(roomId: string) {
    return this.voice?.getRoomStatus(roomId) ?? null;
  }

  // ============================================================================
  // Room Management
  // ============================================================================

  /**
   * Announce presence in a room (for P2P discovery)
   */
  async announceRoomPresence(roomId: string): Promise<void> {
    if (!this.dht) return;
    await this.dht.announceRoom(roomId);
  }

  /**
   * Find peers in a room
   */
  async findRoomPeers(roomId: string): Promise<PeerId[]> {
    if (!this.dht) return [];
    return this.dht.findRoomPeers(roomId);
  }

  // ============================================================================
  // Status
  // ============================================================================

  /**
   * Get current transport state
   */
  getState(): TransportState {
    return this.transport?.getState() ?? 'disconnected';
  }

  /**
   * Get network status
   */
  getNetworkStatus() {
    return this.transport?.getNetworkStatus() ?? {
      state: 'disconnected' as TransportState,
      mode: 'aws',
      awsHealthy: false,
      p2pConnected: false,
      peerCount: 0,
      dhtReady: false,
    };
  }

  /**
   * Get local device capabilities
   */
  getCapabilities(): DeviceCapabilities | null {
    return this.localCapabilities;
  }

  /**
   * Force switch to P2P mode (for testing or user preference)
   */
  async forcePeerToPeer(): Promise<void> {
    await this.transport?.forcePeerToPeer();
  }

  /**
   * Try to restore AWS connection
   */
  async tryRestoreAWS(): Promise<boolean> {
    return this.transport?.tryRestoreAWS() ?? false;
  }

  // ============================================================================
  // Events
  // ============================================================================

  private handleTransportEvent(event: HybridTransportEvent): void {
    switch (event.type) {
      case 'transport-switched':
        console.log('[Integration] Transport switched:', event.data);
        // Could trigger UI notification
        break;

      case 'aws-health-changed':
        console.log('[Integration] AWS health:', event.data);
        break;

      case 'message-stored':
        console.log('[Integration] Message stored for offline delivery');
        break;

      case 'message-delivered':
        console.log('[Integration] Offline message delivered');
        break;
    }
  }

  /**
   * Subscribe to transport events
   */
  onTransportEvent(handler: (event: HybridTransportEvent) => void): () => void {
    return this.transport?.on(handler) ?? (() => {});
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let integrationInstance: RailGunTransportIntegration | null = null;

/**
 * Get the transport integration instance
 */
export function getRailGunTransport(): RailGunTransportIntegration {
  if (!integrationInstance) {
    integrationInstance = new RailGunTransportIntegration();
  }
  return integrationInstance;
}

/**
 * Initialize the transport integration with custom config
 */
export async function initializeRailGunTransport(
  config?: Partial<HybridTransportConfig>
): Promise<RailGunTransportIntegration> {
  const integration = getRailGunTransport();
  await integration.initialize(config);
  return integration;
}

// ============================================================================
// React Hook (for UI integration)
// ============================================================================

/**
 * Example React hook for transport status
 * 
 * Usage:
 * ```tsx
 * function NetworkStatus() {
 *   const status = useTransportStatus();
 *   return <Badge>{status.mode}</Badge>;
 * }
 * ```
 */
export function createUseTransportStatus() {
  // This would be implemented with React hooks
  // Simplified example:
  return function useTransportStatus() {
    const integration = getRailGunTransport();
    return integration.getNetworkStatus();
  };
}
