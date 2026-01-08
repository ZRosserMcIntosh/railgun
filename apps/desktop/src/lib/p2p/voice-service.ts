/**
 * P2P Voice Service
 *
 * Enables voice/video calls to function without centralized infrastructure.
 * Uses a hybrid approach:
 * 1. Small calls (≤4 participants): Direct mesh WebRTC
 * 2. Medium calls (5-12): Peer-hosted SFU by highest-capacity participant
 * 3. Large calls: Distributed SFU with multiple peer-hosts
 *
 * When AWS media servers are available, they're preferred. When unavailable,
 * the system seamlessly falls back to peer-hosted infrastructure.
 */

import type {
  P2PVoiceConfig,
  SFUCandidacy,
  DeviceCapabilities,
} from '@railgun/shared';
import type { PeerId } from '@railgun/shared';

// ============================================================================
// Types
// ============================================================================

interface VoiceParticipant {
  peerId: PeerId;
  userId: string;
  connection?: RTCPeerConnection;
  audioTrack?: MediaStreamTrack;
  videoTrack?: MediaStreamTrack;
  isSFUHost: boolean;
  capabilities?: DeviceCapabilities;
  joinedAt: number;
}

interface VoiceRoomState {
  roomId: string;
  topology: 'mesh' | 'sfu-single' | 'sfu-distributed';
  participants: Map<PeerId, VoiceParticipant>;
  sfuHosts: PeerId[];
  createdAt: number;
  lastActivity: number;
}

interface MediaConstraints {
  audio: boolean | MediaTrackConstraints;
  video: boolean | MediaTrackConstraints;
}

type VoiceEventType = 
  | 'participant-joined'
  | 'participant-left'
  | 'track-added'
  | 'track-removed'
  | 'topology-changed'
  | 'sfu-host-changed'
  | 'connection-state-changed';

interface VoiceEvent {
  type: VoiceEventType;
  roomId: string;
  data: Record<string, unknown>;
}

type VoiceEventHandler = (event: VoiceEvent) => void;

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_VOICE_CONFIG: P2PVoiceConfig = {
  meshThreshold: 4,
  sfuConfig: {
    enabled: true,
    minCapabilityScore: 70,
    rotationInterval: 300000, // 5 minutes
  },
  ice: {
    stunServers: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
    ],
    turnServers: [],
    peerTurnEnabled: true,
  },
};

// ============================================================================
// SFU Host Selection
// ============================================================================

/**
 * Calculate SFU candidacy score for a participant
 */
function calculateSFUScore(capabilities: DeviceCapabilities): number {
  let score = 0;
  
  // Bandwidth (50% of score)
  const bandwidthMbps = capabilities.uploadBandwidth / 1000000;
  score += Math.min(50, bandwidthMbps * 5);
  
  // Device class (30% of score)
  const deviceScores: Record<DeviceCapabilities['deviceClass'], number> = {
    'server': 30,
    'desktop-powerful': 25,
    'desktop-standard': 20,
    'laptop-plugged': 15,
    'laptop-battery': 10,
    'mobile-wifi': 5,
    'mobile-cellular': 0,
  };
  score += deviceScores[capabilities.deviceClass] || 0;
  
  // NAT type (10% of score)
  const natScores: Record<DeviceCapabilities['natType'], number> = {
    'open': 10,
    'full-cone': 8,
    'restricted': 6,
    'port-restricted': 4,
    'symmetric': 2,
    'unknown': 0,
  };
  score += natScores[capabilities.natType] || 0;
  
  // Availability (10% of score)
  if (capabilities.availability === 'always') score += 10;
  else if (capabilities.availability === 'when-active') score += 5;
  
  // Battery penalty
  if (capabilities.batteryStatus === 'low') score -= 10;
  if (capabilities.batteryStatus === 'critical') score -= 30;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Select the best SFU hosts from participants
 */
function selectSFUHosts(
  participants: Map<PeerId, VoiceParticipant>,
  count: number,
  minScore: number
): PeerId[] {
  const candidates: SFUCandidacy[] = [];
  
  for (const [peerId, participant] of participants) {
    if (!participant.capabilities) continue;
    
    const score = calculateSFUScore(participant.capabilities);
    if (score >= minScore) {
      candidates.push({
        peerId,
        capabilities: participant.capabilities,
        score,
        currentLoad: 0, // Would track actual load
        maxCapacity: participant.capabilities.maxRelayConnections,
      });
    }
  }
  
  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  
  return candidates.slice(0, count).map(c => c.peerId);
}

// ============================================================================
// P2P Voice Service
// ============================================================================

export class P2PVoiceService {
  private config: P2PVoiceConfig;
  private localPeerId: PeerId | null = null;
  private localCapabilities: DeviceCapabilities | null = null;
  private rooms: Map<string, VoiceRoomState> = new Map();
  private localStream: MediaStream | null = null;
  private eventHandlers: Set<VoiceEventHandler> = new Set();

  constructor(config: Partial<P2PVoiceConfig> = {}) {
    this.config = { ...DEFAULT_VOICE_CONFIG, ...config };
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Initialize the voice service
   */
  async initialize(peerId: PeerId, capabilities: DeviceCapabilities): Promise<void> {
    this.localPeerId = peerId;
    this.localCapabilities = capabilities;
    console.log('[P2PVoice] Initialized with peer:', peerId);
  }

  /**
   * Shutdown the voice service
   */
  async shutdown(): Promise<void> {
    // Leave all rooms
    for (const roomId of this.rooms.keys()) {
      await this.leaveRoom(roomId);
    }
    
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    console.log('[P2PVoice] Shutdown complete');
  }

  // ============================================================================
  // Room Management
  // ============================================================================

  /**
   * Join a voice room
   */
  async joinRoom(
    roomId: string,
    constraints: MediaConstraints = { audio: true, video: false }
  ): Promise<void> {
    if (!this.localPeerId || !this.localCapabilities) {
      throw new Error('Voice service not initialized');
    }

    // Get local media stream
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

    // Create room state
    const room: VoiceRoomState = {
      roomId,
      topology: 'mesh', // Start with mesh
      participants: new Map(),
      sfuHosts: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    // Add self as participant
    room.participants.set(this.localPeerId, {
      peerId: this.localPeerId,
      userId: this.localPeerId, // Would be actual user ID
      audioTrack: this.localStream.getAudioTracks()[0],
      videoTrack: this.localStream.getVideoTracks()[0],
      isSFUHost: false,
      capabilities: this.localCapabilities,
      joinedAt: Date.now(),
    });

    this.rooms.set(roomId, room);
    console.log('[P2PVoice] Joined room:', roomId);

    this.emit({
      type: 'participant-joined',
      roomId,
      data: { peerId: this.localPeerId },
    });
  }

  /**
   * Leave a voice room
   */
  async leaveRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Close all peer connections
    for (const participant of room.participants.values()) {
      if (participant.connection) {
        participant.connection.close();
      }
    }

    // If we were SFU host, trigger re-election
    if (this.localPeerId && room.sfuHosts.includes(this.localPeerId)) {
      await this.handleSFUHostLeft(room);
    }

    this.rooms.delete(roomId);
    console.log('[P2PVoice] Left room:', roomId);

    this.emit({
      type: 'participant-left',
      roomId,
      data: { peerId: this.localPeerId },
    });
  }

  /**
   * Add a remote participant to a room
   */
  async addParticipant(
    roomId: string,
    peerId: PeerId,
    capabilities?: DeviceCapabilities
  ): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error('Not in room');
    }

    // Create participant entry
    const participant: VoiceParticipant = {
      peerId,
      userId: peerId,
      isSFUHost: false,
      capabilities,
      joinedAt: Date.now(),
    };

    room.participants.set(peerId, participant);
    room.lastActivity = Date.now();

    // Check if we need to change topology
    await this.evaluateTopology(room);

    // Establish connection based on topology
    if (room.topology === 'mesh') {
      await this.establishMeshConnection(room, participant);
    } else {
      await this.establishSFUConnection(room, participant);
    }

    this.emit({
      type: 'participant-joined',
      roomId,
      data: { peerId },
    });
  }

  /**
   * Remove a participant from a room
   */
  async removeParticipant(roomId: string, peerId: PeerId): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(peerId);
    if (participant?.connection) {
      participant.connection.close();
    }

    room.participants.delete(peerId);
    room.lastActivity = Date.now();

    // Check if we need to change topology
    await this.evaluateTopology(room);

    // Handle SFU host leaving
    if (room.sfuHosts.includes(peerId)) {
      await this.handleSFUHostLeft(room);
    }

    this.emit({
      type: 'participant-left',
      roomId,
      data: { peerId },
    });
  }

  // ============================================================================
  // Topology Management
  // ============================================================================

  /**
   * Evaluate and potentially change room topology
   */
  private async evaluateTopology(room: VoiceRoomState): Promise<void> {
    const participantCount = room.participants.size;
    const oldTopology = room.topology;

    if (participantCount <= this.config.meshThreshold) {
      // Use mesh for small groups
      room.topology = 'mesh';
      room.sfuHosts = [];
    } else if (participantCount <= 12) {
      // Use single peer-hosted SFU for medium groups
      room.topology = 'sfu-single';
      if (room.sfuHosts.length === 0) {
        await this.electSFUHost(room, 1);
      }
    } else {
      // Use distributed SFU for large groups
      room.topology = 'sfu-distributed';
      const neededHosts = Math.ceil(participantCount / 10);
      if (room.sfuHosts.length < neededHosts) {
        await this.electSFUHost(room, neededHosts);
      }
    }

    if (oldTopology !== room.topology) {
      console.log(`[P2PVoice] Topology changed: ${oldTopology} -> ${room.topology}`);
      
      this.emit({
        type: 'topology-changed',
        roomId: room.roomId,
        data: {
          oldTopology,
          newTopology: room.topology,
          sfuHosts: room.sfuHosts,
        },
      });

      // Reconnect all participants with new topology
      await this.reconnectForTopology(room);
    }
  }

  /**
   * Elect SFU host(s) for a room
   */
  private async electSFUHost(room: VoiceRoomState, count: number): Promise<void> {
    const minScore = this.config.sfuConfig.minCapabilityScore;
    const hosts = selectSFUHosts(room.participants, count, minScore);

    if (hosts.length === 0) {
      console.warn('[P2PVoice] No eligible SFU hosts, staying in mesh');
      room.topology = 'mesh';
      return;
    }

    room.sfuHosts = hosts;

    // Mark hosts in participant map
    for (const [peerId, participant] of room.participants) {
      participant.isSFUHost = hosts.includes(peerId);
    }

    console.log('[P2PVoice] Elected SFU hosts:', hosts);

    this.emit({
      type: 'sfu-host-changed',
      roomId: room.roomId,
      data: { sfuHosts: hosts },
    });
  }

  /**
   * Handle SFU host leaving
   */
  private async handleSFUHostLeft(room: VoiceRoomState): Promise<void> {
    // Re-elect hosts
    const neededHosts = room.topology === 'sfu-single' ? 1 : 
      Math.ceil(room.participants.size / 10);
    
    await this.electSFUHost(room, neededHosts);

    if (room.sfuHosts.length === 0 && room.participants.size > this.config.meshThreshold) {
      // Fall back to mesh if no hosts available
      console.warn('[P2PVoice] No SFU hosts available, falling back to mesh');
      room.topology = 'mesh';
      await this.reconnectForTopology(room);
    }
  }

  /**
   * Reconnect all participants for new topology
   */
  private async reconnectForTopology(room: VoiceRoomState): Promise<void> {
    // Close existing connections
    for (const participant of room.participants.values()) {
      if (participant.peerId !== this.localPeerId && participant.connection) {
        participant.connection.close();
        participant.connection = undefined;
      }
    }

    // Establish new connections
    for (const participant of room.participants.values()) {
      if (participant.peerId !== this.localPeerId) {
        if (room.topology === 'mesh') {
          await this.establishMeshConnection(room, participant);
        } else {
          await this.establishSFUConnection(room, participant);
        }
      }
    }
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Establish mesh connection to a participant
   */
  private async establishMeshConnection(
    room: VoiceRoomState,
    participant: VoiceParticipant
  ): Promise<void> {
    if (!this.localStream) return;

    const connection = new RTCPeerConnection({
      iceServers: [
        ...this.config.ice.stunServers.map(url => ({ urls: url })),
        ...this.config.ice.turnServers.map(server => ({
          urls: server.url,
          username: server.username,
          credential: server.credential,
        })),
      ],
    });

    // Add local tracks
    for (const track of this.localStream.getTracks()) {
      connection.addTrack(track, this.localStream);
    }

    // Handle incoming tracks
    connection.ontrack = (event) => {
      if (event.track.kind === 'audio') {
        participant.audioTrack = event.track;
      } else if (event.track.kind === 'video') {
        participant.videoTrack = event.track;
      }

      this.emit({
        type: 'track-added',
        roomId: room.roomId,
        data: {
          peerId: participant.peerId,
          kind: event.track.kind,
        },
      });
    };

    // Handle connection state
    connection.onconnectionstatechange = () => {
      this.emit({
        type: 'connection-state-changed',
        roomId: room.roomId,
        data: {
          peerId: participant.peerId,
          state: connection.connectionState,
        },
      });
    };

    // Handle ICE candidates
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignalingMessage(participant.peerId, {
          type: 'ice-candidate',
          candidate: event.candidate,
        });
      }
    };

    participant.connection = connection;

    // Create offer if we're the initiator (lexicographically lower peer ID)
    if (this.localPeerId && this.localPeerId < participant.peerId) {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      this.sendSignalingMessage(participant.peerId, {
        type: 'offer',
        sdp: offer,
      });
    }
  }

  /**
   * Establish SFU connection (connect to SFU host instead of direct peer)
   */
  private async establishSFUConnection(
    room: VoiceRoomState,
    participant: VoiceParticipant
  ): Promise<void> {
    // If we're the SFU host, accept incoming connections
    if (this.localPeerId && room.sfuHosts.includes(this.localPeerId)) {
      // SFU host logic - would handle multiple incoming streams
      await this.handleSFUIncoming(room, participant);
    } else {
      // Connect to SFU host
      const sfuHost = this.selectBestSFUHost(room);
      if (sfuHost) {
        await this.connectToSFUHost(room, sfuHost);
      }
    }
  }

  private async handleSFUIncoming(
    room: VoiceRoomState,
    _participant: VoiceParticipant
  ): Promise<void> {
    // SFU host receives streams and redistributes
    // This is a simplified version - real SFU would use selective forwarding
    console.log(`[P2PVoice] SFU handling incoming for room ${room.roomId}`);
  }

  private selectBestSFUHost(room: VoiceRoomState): PeerId | null {
    if (room.sfuHosts.length === 0) return null;
    
    // For distributed SFU, would select based on load/proximity
    // For now, just return first host
    return room.sfuHosts[0];
  }

  private async connectToSFUHost(room: VoiceRoomState, hostPeerId: PeerId): Promise<void> {
    const host = room.participants.get(hostPeerId);
    if (host) {
      await this.establishMeshConnection(room, host);
    }
  }

  // ============================================================================
  // Signaling
  // ============================================================================

  /**
   * Send signaling message to a peer
   */
  private sendSignalingMessage(peerId: PeerId, message: Record<string, unknown>): void {
    // In production, would send via P2P transport or signaling server
    console.log(`[P2PVoice] Signaling to ${peerId}:`, message.type);
  }

  /**
   * Handle incoming signaling message
   */
  async handleSignalingMessage(
    roomId: string,
    fromPeerId: PeerId,
    message: Record<string, unknown>
  ): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(fromPeerId);
    if (!participant?.connection) return;

    switch (message.type) {
      case 'offer':
        await participant.connection.setRemoteDescription(message.sdp as RTCSessionDescriptionInit);
        const answer = await participant.connection.createAnswer();
        await participant.connection.setLocalDescription(answer);
        this.sendSignalingMessage(fromPeerId, { type: 'answer', sdp: answer });
        break;

      case 'answer':
        await participant.connection.setRemoteDescription(message.sdp as RTCSessionDescriptionInit);
        break;

      case 'ice-candidate':
        await participant.connection.addIceCandidate(message.candidate as RTCIceCandidateInit);
        break;
    }
  }

  // ============================================================================
  // Media Controls
  // ============================================================================

  /**
   * Mute/unmute audio
   */
  setAudioEnabled(enabled: boolean): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  /**
   * Enable/disable video
   */
  setVideoEnabled(enabled: boolean): void {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  /**
   * Get audio/video tracks for a participant
   */
  getParticipantTracks(roomId: string, peerId: PeerId): {
    audio?: MediaStreamTrack;
    video?: MediaStreamTrack;
  } {
    const room = this.rooms.get(roomId);
    if (!room) return {};

    const participant = room.participants.get(peerId);
    if (!participant) return {};

    return {
      audio: participant.audioTrack,
      video: participant.videoTrack,
    };
  }

  // ============================================================================
  // Events
  // ============================================================================

  /**
   * Subscribe to voice events
   */
  on(handler: VoiceEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: VoiceEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[P2PVoice] Event handler error:', error);
      }
    }
  }

  // ============================================================================
  // Status
  // ============================================================================

  /**
   * Get room status
   */
  getRoomStatus(roomId: string): {
    topology: string;
    participantCount: number;
    sfuHosts: PeerId[];
    isConnected: boolean;
  } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    return {
      topology: room.topology,
      participantCount: room.participants.size,
      sfuHosts: room.sfuHosts,
      isConnected: true,
    };
  }

  /**
   * Check if we're SFU host for a room
   */
  isSFUHost(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !this.localPeerId) return false;
    return room.sfuHosts.includes(this.localPeerId);
  }
}

// ============================================================================
// Factory
// ============================================================================

let voiceInstance: P2PVoiceService | null = null;

/**
 * Get P2P voice service instance
 */
export function getP2PVoice(): P2PVoiceService {
  if (!voiceInstance) {
    voiceInstance = new P2PVoiceService();
  }
  return voiceInstance;
}

/**
 * Create new P2P voice service instance
 */
export function createP2PVoice(config?: Partial<P2PVoiceConfig>): P2PVoiceService {
  return new P2PVoiceService(config);
}
