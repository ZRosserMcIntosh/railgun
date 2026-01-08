/**
 * Rail Gun P2P Module
 *
 * Provides censorship-resistant peer-to-peer networking capabilities.
 * This module enables Rail Gun to operate without centralized infrastructure.
 *
 * Components:
 * - HybridTransport: AWS-primary with P2P fallback
 * - DHT: Decentralized peer discovery
 * - P2PVoice: Peer-hosted voice/video
 * - Bootstrap: Multi-transport initial discovery
 * - Relay: Committee-based message relay
 * - Integration: High-level API for app integration
 */

// Hybrid Transport (AWS + P2P)
export {
  HybridTransportService,
  getHybridTransport,
  createHybridTransport,
} from './hybrid-transport';

// DHT (Distributed Hash Table)
export {
  DHTService,
  initializeDHT,
  getDHT,
  createDHTKey,
} from './dht-service';

// P2P Voice/Video
export {
  P2PVoiceService,
  getP2PVoice,
  createP2PVoice,
} from './voice-service';

// Bootstrap Service
export { BootstrapService, getBootstrapService } from './bootstrap-service';

// Bootstrap Nodes Configuration
export {
  PRODUCTION_BOOTSTRAP_LIST,
  IPFS_GATEWAYS,
  TOR_CONFIG,
  I2P_CONFIG,
  generateBootstrapKeypair,
  signBootstrapList,
} from './bootstrap-nodes';

// Peer-Hosted TURN Relay
export {
  PeerHostedTURNService,
  createTURNService,
  getTURNService,
  getDefaultTURNConfig,
  calculateRelayBandwidth,
  type TURNConfig,
  type RelayCandidate,
  type RelayAllocation,
  type RelaySession,
} from './peer-turn';

// Cryptographic Utilities
export {
  verifyEd25519Signature,
  signEd25519,
  generateEd25519Keypair,
  verifyBootstrapListSignature,
  verifyBootstrapNodeSignature,
  verifyDHTRecordSignature,
  signDHTRecord,
  sha256,
  hmacSha256,
  randomBytes,
  constantTimeEqual,
  hexToBytes,
  bytesToHex,
  TRUSTED_BOOTSTRAP_SIGNING_KEYS,
  type DHTRecordData,
} from './crypto-utils';

// Relay Service
export {
  P2PRelayService,
  createP2PRelayService,
  selectCommittee,
  getCommitteeMembership,
  generateProofOfWork,
  verifyProofOfWork,
  padMessage,
  unpadMessage,
  ReputationManager,
} from './relay-service';

// High-Level Integration
export {
  RailGunTransportIntegration,
  getRailGunTransport,
  initializeRailGunTransport,
  createUseTransportStatus,
} from './integration';

// Security Hardening (SEC-002, SEC-003, SEC-004 Remediations)
export {
  generateX25519KeyPair,
  deriveX25519SharedSecret,
  deriveSessionKeys,
  encryptWithSessionKey,
  decryptWithSessionKey,
  initiateKeyExchange,
  completeKeyExchange,
  PeerReputationManager,
  verifyDTLSFingerprint,
  extractFingerprintFromSDP,
  type X25519KeyPair,
  type SessionKeyExchange,
  type PeerReputationScore,
  type ReputationConfig,
} from './security-hardening';

// Re-export types from shared
export type {
  // Hybrid Transport Types
  TransportMode,
  TransportState,
  TransportSwitchReason,
  DeviceClass,
  DeviceCapabilities,
  PeerScore,
  RoutingDecision,
  QueuedMessage,
  StoreNodeStatus,
  HybridTransportConfig,
  HybridTransportEvent,
  DHTKeyType,
  SignedDHTRecord,
  RendezvousPoint,
  P2PVoiceConfig,
  SFUCandidacy,
  // P2P Types
  PeerId,
  Multiaddr,
  PeerInfo,
  PeerReputation,
  RelayCommittee,
  RelayEnvelope,
  RelayProof,
  RelayAck,
  P2PConfig,
  // Bootstrap Types
  BootstrapConfig,
  CachedPeer,
  DiscoveryEvent,
} from '@railgun/shared';
