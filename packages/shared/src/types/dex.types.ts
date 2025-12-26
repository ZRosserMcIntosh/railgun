/**
 * Rail Gun DEX Types
 *
 * Type definitions for the decentralized BTC ↔ XMR atomic swap exchange.
 * This implements non-custodial, trustless swaps using adaptor signatures.
 */

// ============================================================================
// Core Types
// ============================================================================

/** Supported swap assets */
export type SwapAsset = 'BTC' | 'XMR';

/** Unique swap identifier */
export type SwapId = string;

/** Unique offer identifier */
export type OfferId = string;

/** Tor hidden service address */
export type OnionAddress = string;

// ============================================================================
// Swap Offer
// ============================================================================

/** Swap offer published to DHT */
export interface SwapOffer {
  /** Unique offer ID (random 32 bytes hex) */
  offerId: OfferId;

  /** Asset the maker is offering */
  makerAsset: SwapAsset;

  /** Amount maker is offering (satoshis for BTC, piconeros for XMR) */
  makerAmount: bigint;

  /** Asset the maker wants */
  takerAsset: SwapAsset;

  /** Amount maker wants (satoshis for BTC, piconeros for XMR) */
  takerAmount: bigint;

  /** Exchange rate (takerAmount / makerAmount) */
  rate: number;

  /** Minimum acceptable amount (for partial fills) */
  minAmount?: bigint;

  /** Maximum acceptable amount */
  maxAmount?: bigint;

  /** Offer creation timestamp */
  createdAt: number;

  /** Offer expiration timestamp */
  expiresAt: number;

  /** Time allowed for counterparty to lock funds (seconds) */
  lockTimeout: number;

  /** Contact endpoint (Tor .onion address) */
  contactEndpoint: OnionAddress;

  /** Proof of funds (optional, privacy trade-off) */
  proofOfFunds?: ProofOfFunds;

  /** Anti-spam proof of work */
  powNonce: string;
  powDifficulty: number;

  /** Ed25519 signature of offer (proves ownership of endpoint) */
  signature: string;

  /** Offer version for protocol compatibility */
  protocolVersion: number;
}

/** Proof that maker has funds to complete swap */
export interface ProofOfFunds {
  type: 'btc_utxo_proof' | 'xmr_reserve_proof';
  data: string;
  validUntil: number;
}

/** Filter for discovering offers */
export interface OfferFilter {
  /** Filter by asset being offered */
  makerAsset?: SwapAsset;

  /** Filter by asset being requested */
  takerAsset?: SwapAsset;

  /** Minimum amount (in maker's asset) */
  minAmount?: bigint;

  /** Maximum amount (in maker's asset) */
  maxAmount?: bigint;

  /** Minimum exchange rate */
  minRate?: number;

  /** Maximum exchange rate */
  maxRate?: number;

  /** Only show offers expiring after this time */
  minExpiry?: number;
}

// ============================================================================
// Swap State Machine
// ============================================================================

/** Swap lifecycle states */
export enum SwapState {
  // Initial states
  CREATED = 'created',
  OFFER_PUBLISHED = 'offer_published',

  // Negotiation
  OFFER_TAKEN = 'offer_taken',
  KEYS_EXCHANGING = 'keys_exchanging',
  KEYS_EXCHANGED = 'keys_exchanged',

  // Locking phase
  AWAITING_BTC_LOCK = 'awaiting_btc_lock',
  BTC_LOCKED = 'btc_locked',
  AWAITING_XMR_LOCK = 'awaiting_xmr_lock',
  XMR_LOCKED = 'xmr_locked',

  // Settlement phase
  AWAITING_XMR_CLAIM = 'awaiting_xmr_claim',
  XMR_CLAIMED = 'xmr_claimed',
  AWAITING_BTC_CLAIM = 'awaiting_btc_claim',
  BTC_CLAIMED = 'btc_claimed',

  // Completion
  COMPLETED = 'completed',

  // Failure/refund states
  CANCELLED = 'cancelled',
  AWAITING_BTC_REFUND = 'awaiting_btc_refund',
  BTC_REFUNDED = 'btc_refunded',
  AWAITING_XMR_REFUND = 'awaiting_xmr_refund',
  XMR_REFUNDED = 'xmr_refunded',
  EXPIRED = 'expired',
  FAILED = 'failed',
}

/** Role in the swap */
export type SwapRole = 'maker' | 'taker';

/** Which side of the BTC/XMR swap */
export type SwapSide = 'btc_seller' | 'xmr_seller';

// ============================================================================
// Swap Session
// ============================================================================

/** Active swap session */
export interface SwapSession {
  /** Unique swap ID */
  swapId: SwapId;

  /** Current state */
  state: SwapState;

  /** Our role in this swap */
  role: SwapRole;

  /** Which side we're on */
  side: SwapSide;

  /** Bitcoin amount (satoshis) */
  btcAmount: bigint;

  /** Monero amount (piconeros) */
  xmrAmount: bigint;

  /** Exchange rate at time of swap */
  rate: number;

  /** Our local keys (NEVER transmitted except where protocol requires) */
  localKeys: SwapKeys;

  /** Counterparty's public info */
  counterparty: CounterpartyInfo;

  /** Transaction IDs */
  transactions: SwapTransactions;

  /** Timelock configuration */
  timelocks: SwapTimelocks;

  /** Timestamps */
  timestamps: SwapTimestamps;

  /** Error information if failed */
  error?: SwapError;

  /** Protocol version */
  protocolVersion: number;
}

/** Local cryptographic keys for swap */
export interface SwapKeys {
  /** Bitcoin private key (WIF format) */
  btcPrivkey?: string;

  /** Bitcoin public key (hex) */
  btcPubkey?: string;

  /** Monero spend key */
  xmrSpendKey?: string;

  /** Monero view key */
  xmrViewKey?: string;

  /** Monero public spend key */
  xmrPubSpendKey?: string;

  /** Monero public view key */
  xmrPubViewKey?: string;

  /** Adaptor signature secret (scalar) */
  adaptorSecret?: string;

  /** Adaptor signature point (curve point) */
  adaptorPoint?: string;

  /** Pre-signed refund transaction */
  btcRefundTx?: string;
}

/** Counterparty's public information */
export interface CounterpartyInfo {
  /** Tor endpoint */
  endpoint: OnionAddress;

  /** Bitcoin public key */
  btcPubkey?: string;

  /** Monero public view key */
  xmrViewKey?: string;

  /** Adaptor point from counterparty */
  adaptorPoint?: string;

  /** Reputation (if available) */
  reputation?: TraderReputation;
}

/** Transaction IDs for swap */
export interface SwapTransactions {
  /** BTC lock transaction ID */
  btcLockTxid?: string;

  /** BTC lock transaction hex (for monitoring) */
  btcLockTxHex?: string;

  /** XMR lock transaction ID */
  xmrLockTxid?: string;

  /** BTC claim transaction ID */
  btcClaimTxid?: string;

  /** XMR claim transaction ID */
  xmrClaimTxid?: string;

  /** BTC refund transaction ID (if refunded) */
  btcRefundTxid?: string;

  /** XMR refund transaction ID (if refunded) */
  xmrRefundTxid?: string;
}

/** Timelock configuration */
export interface SwapTimelocks {
  /** BTC refund timelock (block height or timestamp) */
  btcRefundTime: number;

  /** XMR refund timelock (block height) */
  xmrRefundTime: number;

  /** Lock timeout (seconds to lock after agreement) */
  lockTimeout: number;
}

/** Swap timestamps */
export interface SwapTimestamps {
  createdAt: number;
  takenAt?: number;
  keysExchangedAt?: number;
  btcLockedAt?: number;
  xmrLockedAt?: number;
  xmrClaimedAt?: number;
  btcClaimedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  refundedAt?: number;
}

/** Swap error information */
export interface SwapError {
  code: SwapErrorCode;
  message: string;
  details?: Record<string, unknown>;
  recoverable: boolean;
}

/** Swap error codes */
export enum SwapErrorCode {
  // Network errors
  NETWORK_ERROR = 'network_error',
  COUNTERPARTY_OFFLINE = 'counterparty_offline',
  TOR_CONNECTION_FAILED = 'tor_connection_failed',

  // Protocol errors
  INVALID_KEYS = 'invalid_keys',
  INVALID_SIGNATURE = 'invalid_signature',
  INVALID_ADAPTOR = 'invalid_adaptor',
  PROTOCOL_VIOLATION = 'protocol_violation',

  // Transaction errors
  BTC_LOCK_FAILED = 'btc_lock_failed',
  XMR_LOCK_FAILED = 'xmr_lock_failed',
  BTC_CLAIM_FAILED = 'btc_claim_failed',
  XMR_CLAIM_FAILED = 'xmr_claim_failed',
  INSUFFICIENT_FUNDS = 'insufficient_funds',
  FEE_TOO_HIGH = 'fee_too_high',

  // Timeout errors
  LOCK_TIMEOUT = 'lock_timeout',
  CLAIM_TIMEOUT = 'claim_timeout',

  // User errors
  USER_CANCELLED = 'user_cancelled',
}

// ============================================================================
// Bitcoin Specific
// ============================================================================

/** Bitcoin network */
export type BitcoinNetwork = 'mainnet' | 'testnet' | 'regtest';

/** Bitcoin UTXO */
export interface BitcoinUtxo {
  txid: string;
  vout: number;
  value: bigint;
  scriptPubKey: string;
  confirmations: number;
}

/** Bitcoin lock script parameters */
export interface BtcLockScriptParams {
  /** Alice's public key (BTC seller) */
  alicePubkey: string;

  /** Bob's public key (XMR seller) */
  bobPubkey: string;

  /** Refund timelock (block height or timestamp) */
  refundTime: number;
}

/** Bitcoin transaction for swap */
export interface BtcSwapTransaction {
  txid: string;
  hex: string;
  vout: number;
  value: bigint;
  confirmations: number;
  scriptType: 'lock' | 'claim' | 'refund';
}

// ============================================================================
// Monero Specific
// ============================================================================

/** Monero network */
export type MoneroNetwork = 'mainnet' | 'stagenet' | 'testnet';

/** Monero subaddress */
export interface MoneroSubaddress {
  address: string;
  accountIndex: number;
  subaddressIndex: number;
}

/** Monero output */
export interface MoneroOutput {
  txHash: string;
  amount: bigint;
  index: number;
  keyImage?: string;
  unlockTime: number;
  isSpent: boolean;
}

/** Monero lock transaction parameters */
export interface XmrLockParams {
  /** Destination address (derived from swap keys) */
  destinationAddress: string;

  /** Amount in piconeros */
  amount: bigint;

  /** Unlock time (block height) */
  unlockTime: number;
}

// ============================================================================
// Adaptor Signatures
// ============================================================================

/** Adaptor signature (encrypted signature) */
export interface AdaptorSignature {
  /** Encrypted signature component s' */
  sPrime: string;

  /** Signature R point */
  R: string;

  /** Adaptor point T (t*G where t is secret) */
  T: string;

  /** Message hash this signs */
  messageHash: string;
}

/** Complete signature (after adaptor revealed) */
export interface CompleteSignature {
  /** Signature component r */
  r: string;

  /** Signature component s */
  s: string;

  /** Recovery parameter */
  v: number;
}

// ============================================================================
// Reputation System
// ============================================================================

/** Trader reputation (pseudonymous) */
export interface TraderReputation {
  /** Blinded credential (unlinkable to real identity) */
  credential: BlindedCredential;

  /** Number of completed swaps */
  completedSwaps: number;

  /** Success rate (0-100) */
  successRate: number;

  /** Average completion time (seconds) */
  avgCompletionTime: number;

  /** Total volume traded (in BTC satoshis) */
  totalVolume: bigint;

  /** First trade timestamp */
  firstTrade: number;

  /** Last trade timestamp */
  lastTrade: number;
}

/** Blinded credential for unlinkable reputation */
export interface BlindedCredential {
  /** Credential type */
  type: 'blind_signature' | 'anonymous_credential';

  /** Credential data */
  data: string;

  /** Issuer public key */
  issuerPubkey: string;

  /** Valid until */
  expiresAt: number;
}

// ============================================================================
// Watchtower
// ============================================================================

/** Watchtower registration */
export interface WatchtowerRegistration {
  /** Swap ID being watched */
  swapId: SwapId;

  /** BTC lock transaction ID */
  btcLockTxid: string;

  /** Pre-signed BTC refund transaction */
  btcRefundTx: string;

  /** BTC refund timelock */
  btcRefundTime: number;

  /** XMR lock transaction ID */
  xmrLockTxid?: string;

  /** Watchtower's Tor endpoint */
  watchtowerEndpoint: OnionAddress;

  /** Registration timestamp */
  registeredAt: number;

  /** Fee paid to watchtower */
  feePaid: bigint;
}

/** Watchtower receipt */
export interface WatchtowerReceipt {
  /** Registration ID */
  registrationId: string;

  /** Watchtower signature confirming registration */
  signature: string;

  /** Monitoring until timestamp */
  monitoringUntil: number;
}

// ============================================================================
// Messages
// ============================================================================

/** Swap protocol messages */
export type SwapMessage =
  | { type: 'offer_accept'; offerId: OfferId; takerEndpoint: OnionAddress }
  | { type: 'keys_exchange'; btcPubkey: string; xmrViewKey: string; adaptorPoint: string }
  | { type: 'btc_locked'; txid: string; vout: number }
  | { type: 'xmr_locked'; txid: string }
  | { type: 'xmr_claimed'; txid: string; adaptorSecret: string }
  | { type: 'btc_claimed'; txid: string }
  | { type: 'cancel'; reason: string }
  | { type: 'error'; code: SwapErrorCode; message: string };

// ============================================================================
// Events
// ============================================================================

/** DEX events */
export type DexEvent =
  | { type: 'offer_created'; offer: SwapOffer }
  | { type: 'offer_taken'; offerId: OfferId; taker: OnionAddress }
  | { type: 'swap_started'; session: SwapSession }
  | { type: 'state_changed'; swapId: SwapId; oldState: SwapState; newState: SwapState }
  | { type: 'btc_locked'; swapId: SwapId; txid: string; confirmations: number }
  | { type: 'xmr_locked'; swapId: SwapId; txid: string }
  | { type: 'swap_completed'; session: SwapSession }
  | { type: 'swap_failed'; session: SwapSession; error: SwapError }
  | { type: 'refund_triggered'; swapId: SwapId; asset: SwapAsset };

/** Event handler type */
export type DexEventHandler = (event: DexEvent) => void;

// ============================================================================
// Configuration
// ============================================================================

/** DEX configuration */
export interface DexConfig {
  /** Bitcoin network */
  btcNetwork: BitcoinNetwork;

  /** Monero network */
  xmrNetwork: MoneroNetwork;

  /** Enable Tor (required for privacy) */
  torEnabled: boolean;

  /** Tor SOCKS proxy */
  torProxy?: string;

  /** Default offer expiry (seconds) */
  defaultOfferExpiry: number;

  /** Default lock timeout (seconds) */
  defaultLockTimeout: number;

  /** BTC refund timelock (blocks) */
  btcRefundBlocks: number;

  /** XMR refund timelock (blocks) */
  xmrRefundBlocks: number;

  /** Minimum confirmations for BTC lock */
  btcMinConfirmations: number;

  /** Minimum confirmations for XMR lock */
  xmrMinConfirmations: number;

  /** Proof of work difficulty for offers */
  offerPowDifficulty: number;

  /** Watchtower endpoints (optional) */
  watchtowers?: OnionAddress[];

  /** Bitcoin RPC/Electrum config */
  btcRpc?: {
    type: 'electrum' | 'rpc';
    url: string;
    auth?: { user: string; pass: string };
  };

  /** Monero RPC config */
  xmrRpc?: {
    daemonUrl: string;
    walletUrl: string;
  };
}

/** Default DEX configuration */
export const DEFAULT_DEX_CONFIG: DexConfig = {
  btcNetwork: 'mainnet',
  xmrNetwork: 'mainnet',
  torEnabled: true,
  defaultOfferExpiry: 600, // 10 minutes
  defaultLockTimeout: 14400, // 4 hours
  btcRefundBlocks: 144, // ~24 hours
  xmrRefundBlocks: 1440, // ~48 hours
  btcMinConfirmations: 1,
  xmrMinConfirmations: 10,
  offerPowDifficulty: 20,
};

// ============================================================================
// Fee Estimation
// ============================================================================

/** Estimated fees for a swap */
export interface SwapFeeEstimate {
  /** BTC lock transaction fee */
  btcLockFee: bigint;

  /** BTC claim transaction fee */
  btcClaimFee: bigint;

  /** BTC refund transaction fee (if needed) */
  btcRefundFee: bigint;

  /** XMR lock transaction fee */
  xmrLockFee: bigint;

  /** XMR claim transaction fee */
  xmrClaimFee: bigint;

  /** Total fees (worst case: refund) */
  totalWorstCase: {
    btc: bigint;
    xmr: bigint;
  };

  /** Total fees (happy path) */
  totalHappyPath: {
    btc: bigint;
    xmr: bigint;
  };

  /** Fee rate used for estimation */
  btcFeeRate: number; // sat/vbyte
  xmrFeeMultiplier: number;
}
