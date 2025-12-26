/**
 * Rail Gun Decentralized Exchange Service
 *
 * Implementation of BTC ↔ XMR atomic swaps using adaptor signatures.
 * This is a non-custodial, trustless exchange with no central authority.
 */

import {
  SwapState,
  SwapErrorCode,
  type SwapId,
  type OfferId,
  type SwapOffer,
  type SwapSession,
  type SwapSide,
  type SwapKeys,
  type SwapMessage,
  type SwapFeeEstimate,
  type DexConfig,
  type DexEvent,
  type DexEventHandler,
  type OfferFilter,
  type OnionAddress,
  type SwapAsset,
  type WatchtowerRegistration,
  type WatchtowerReceipt,
} from '@railgun/shared';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate random hex string
 */
function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate SHA-256 hash
 */
async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const inputBytes = encoder.encode(data);
  const buffer = new ArrayBuffer(inputBytes.length);
  new Uint8Array(buffer).set(inputBytes);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Count leading zeros in hex string (for PoW)
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

// ============================================================================
// Swap State Machine
// ============================================================================

/**
 * Valid state transitions for swap state machine
 */
const VALID_TRANSITIONS: Record<SwapState, SwapState[]> = {
  [SwapState.CREATED]: [SwapState.OFFER_PUBLISHED, SwapState.CANCELLED],
  [SwapState.OFFER_PUBLISHED]: [SwapState.OFFER_TAKEN, SwapState.CANCELLED, SwapState.EXPIRED],
  [SwapState.OFFER_TAKEN]: [SwapState.KEYS_EXCHANGING, SwapState.CANCELLED],
  [SwapState.KEYS_EXCHANGING]: [SwapState.KEYS_EXCHANGED, SwapState.CANCELLED, SwapState.FAILED],
  [SwapState.KEYS_EXCHANGED]: [SwapState.AWAITING_BTC_LOCK, SwapState.CANCELLED],
  [SwapState.AWAITING_BTC_LOCK]: [SwapState.BTC_LOCKED, SwapState.CANCELLED, SwapState.EXPIRED],
  [SwapState.BTC_LOCKED]: [SwapState.AWAITING_XMR_LOCK, SwapState.AWAITING_BTC_REFUND],
  [SwapState.AWAITING_XMR_LOCK]: [SwapState.XMR_LOCKED, SwapState.AWAITING_BTC_REFUND, SwapState.EXPIRED],
  [SwapState.XMR_LOCKED]: [SwapState.AWAITING_XMR_CLAIM, SwapState.AWAITING_BTC_REFUND],
  [SwapState.AWAITING_XMR_CLAIM]: [SwapState.XMR_CLAIMED, SwapState.AWAITING_BTC_REFUND],
  [SwapState.XMR_CLAIMED]: [SwapState.AWAITING_BTC_CLAIM, SwapState.BTC_CLAIMED],
  [SwapState.AWAITING_BTC_CLAIM]: [SwapState.BTC_CLAIMED, SwapState.FAILED],
  [SwapState.BTC_CLAIMED]: [SwapState.COMPLETED],
  [SwapState.COMPLETED]: [],
  [SwapState.CANCELLED]: [],
  [SwapState.AWAITING_BTC_REFUND]: [SwapState.BTC_REFUNDED, SwapState.FAILED],
  [SwapState.BTC_REFUNDED]: [],
  [SwapState.AWAITING_XMR_REFUND]: [SwapState.XMR_REFUNDED, SwapState.FAILED],
  [SwapState.XMR_REFUNDED]: [],
  [SwapState.EXPIRED]: [],
  [SwapState.FAILED]: [],
};

/**
 * Check if state transition is valid
 */
function isValidTransition(from: SwapState, to: SwapState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================================================
// Offer Manager
// ============================================================================

export class OfferManager {
  private offers: Map<OfferId, SwapOffer> = new Map();
  private eventHandlers: Set<(offer: SwapOffer) => void> = new Set();

  /**
   * Create a new swap offer
   */
  async createOffer(params: {
    makerAsset: SwapAsset;
    makerAmount: bigint;
    takerAsset: SwapAsset;
    takerAmount: bigint;
    lockTimeout: number;
    expiresIn: number;
    contactEndpoint: OnionAddress;
    powDifficulty: number;
  }): Promise<SwapOffer> {
    const offerId = randomHex(32);
    const now = Date.now();

    // Generate proof of work
    const { nonce } = await this.generateOfferPoW(offerId, params.powDifficulty);

    const offer: SwapOffer = {
      offerId,
      makerAsset: params.makerAsset,
      makerAmount: params.makerAmount,
      takerAsset: params.takerAsset,
      takerAmount: params.takerAmount,
      rate: Number(params.takerAmount) / Number(params.makerAmount),
      createdAt: now,
      expiresAt: now + params.expiresIn * 1000,
      lockTimeout: params.lockTimeout,
      contactEndpoint: params.contactEndpoint,
      powNonce: nonce,
      powDifficulty: params.powDifficulty,
      signature: '', // Would be Ed25519 signature
      protocolVersion: 1,
    };

    this.offers.set(offerId, offer);
    return offer;
  }

  /**
   * Generate proof of work for offer
   */
  private async generateOfferPoW(
    offerId: string,
    difficulty: number
  ): Promise<{ nonce: string; hash: string }> {
    let nonce = 0;
    let hash: string;

    do {
      nonce++;
      hash = await sha256(`${offerId}:${nonce}`);
    } while (countLeadingZeros(hash) < difficulty);

    return { nonce: nonce.toString(), hash };
  }

  /**
   * Verify an offer's proof of work
   */
  async verifyOffer(offer: SwapOffer): Promise<boolean> {
    // Check expiration
    if (offer.expiresAt < Date.now()) {
      return false;
    }

    // Verify PoW
    const hash = await sha256(`${offer.offerId}:${offer.powNonce}`);
    if (countLeadingZeros(hash) < offer.powDifficulty) {
      return false;
    }

    // TODO: Verify signature

    return true;
  }

  /**
   * Get offers matching filter
   */
  getOffers(filter: OfferFilter = {}): SwapOffer[] {
    const now = Date.now();
    return Array.from(this.offers.values()).filter((offer) => {
      // Remove expired
      if (offer.expiresAt < now) return false;

      // Apply filters
      if (filter.makerAsset && offer.makerAsset !== filter.makerAsset) return false;
      if (filter.takerAsset && offer.takerAsset !== filter.takerAsset) return false;
      if (filter.minAmount && offer.makerAmount < filter.minAmount) return false;
      if (filter.maxAmount && offer.makerAmount > filter.maxAmount) return false;
      if (filter.minRate && offer.rate < filter.minRate) return false;
      if (filter.maxRate && offer.rate > filter.maxRate) return false;

      return true;
    });
  }

  /**
   * Remove an offer
   */
  removeOffer(offerId: OfferId): void {
    this.offers.delete(offerId);
  }

  /**
   * Subscribe to new offers
   */
  onOffer(handler: (offer: SwapOffer) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Emit new offer event (used when receiving offers from DHT)
   */
  emitOffer(offer: SwapOffer): void {
    for (const handler of this.eventHandlers) {
      handler(offer);
    }
  }
}

// ============================================================================
// Swap Manager
// ============================================================================

export class SwapManager {
  private swaps: Map<SwapId, SwapSession> = new Map();
  private eventHandlers: Set<DexEventHandler> = new Set();
  private config: DexConfig;
  private offerManager: OfferManager;

  constructor(config: DexConfig) {
    this.config = config;
    this.offerManager = new OfferManager();
  }

  /**
   * Get offer manager
   */
  getOfferManager(): OfferManager {
    return this.offerManager;
  }

  /**
   * Subscribe to DEX events
   */
  on(handler: DexEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Emit event
   */
  private emit(event: DexEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[DEX] Event handler error:', error);
      }
    }
  }

  /**
   * Create a new swap as maker (publishing offer)
   */
  async createSwap(params: {
    offerAsset: SwapAsset;
    offerAmount: bigint;
    wantAsset: SwapAsset;
    wantAmount: bigint;
    lockTimeout?: number;
    offerExpiry?: number;
  }): Promise<SwapSession> {
    const swapId = randomHex(32);
    const now = Date.now();

    // Determine side based on what we're offering
    const side: SwapSide = params.offerAsset === 'BTC' ? 'btc_seller' : 'xmr_seller';

    // Generate local keys (would use actual crypto in production)
    const localKeys: SwapKeys = {
      btcPubkey: randomHex(33), // Compressed pubkey
      xmrPubViewKey: randomHex(32),
      xmrPubSpendKey: randomHex(32),
      adaptorPoint: randomHex(33),
    };

    const session: SwapSession = {
      swapId,
      state: SwapState.CREATED,
      role: 'maker',
      side,
      btcAmount: params.offerAsset === 'BTC' ? params.offerAmount : params.wantAmount,
      xmrAmount: params.offerAsset === 'XMR' ? params.offerAmount : params.wantAmount,
      rate: Number(params.wantAmount) / Number(params.offerAmount),
      localKeys,
      counterparty: {
        endpoint: '' as OnionAddress,
      },
      transactions: {},
      timelocks: {
        btcRefundTime: now / 1000 + this.config.btcRefundBlocks * 600, // ~10 min/block
        xmrRefundTime: now / 1000 + this.config.xmrRefundBlocks * 120, // ~2 min/block
        lockTimeout: params.lockTimeout || this.config.defaultLockTimeout,
      },
      timestamps: {
        createdAt: now,
      },
      protocolVersion: 1,
    };

    this.swaps.set(swapId, session);
    this.emit({ type: 'swap_started', session });

    return session;
  }

  /**
   * Take an existing offer
   */
  async takeOffer(offer: SwapOffer): Promise<SwapSession> {
    // Verify offer is still valid
    if (!(await this.offerManager.verifyOffer(offer))) {
      throw new Error('Invalid or expired offer');
    }

    const swapId = randomHex(32);
    const now = Date.now();

    // Determine side (opposite of maker)
    const side: SwapSide = offer.makerAsset === 'BTC' ? 'xmr_seller' : 'btc_seller';

    // Generate local keys
    const localKeys: SwapKeys = {
      btcPubkey: randomHex(33),
      xmrPubViewKey: randomHex(32),
      xmrPubSpendKey: randomHex(32),
      adaptorPoint: randomHex(33),
    };

    const session: SwapSession = {
      swapId,
      state: SwapState.OFFER_TAKEN,
      role: 'taker',
      side,
      btcAmount: offer.makerAsset === 'BTC' ? offer.makerAmount : offer.takerAmount,
      xmrAmount: offer.makerAsset === 'XMR' ? offer.makerAmount : offer.takerAmount,
      rate: offer.rate,
      localKeys,
      counterparty: {
        endpoint: offer.contactEndpoint,
      },
      transactions: {},
      timelocks: {
        btcRefundTime: now / 1000 + this.config.btcRefundBlocks * 600,
        xmrRefundTime: now / 1000 + this.config.xmrRefundBlocks * 120,
        lockTimeout: offer.lockTimeout,
      },
      timestamps: {
        createdAt: now,
        takenAt: now,
      },
      protocolVersion: 1,
    };

    this.swaps.set(swapId, session);
    this.emit({ type: 'swap_started', session });
    this.emit({ type: 'offer_taken', offerId: offer.offerId, taker: '' as OnionAddress });

    return session;
  }

  /**
   * Transition swap to new state
   */
  private transition(swapId: SwapId, newState: SwapState): void {
    const session = this.swaps.get(swapId);
    if (!session) {
      throw new Error(`Swap not found: ${swapId}`);
    }

    if (!isValidTransition(session.state, newState)) {
      throw new Error(`Invalid transition: ${session.state} -> ${newState}`);
    }

    const oldState = session.state;
    session.state = newState;

    this.emit({ type: 'state_changed', swapId, oldState, newState });
  }

  /**
   * Handle incoming swap message
   */
  async handleMessage(swapId: SwapId, message: SwapMessage): Promise<void> {
    const session = this.swaps.get(swapId);
    if (!session) {
      throw new Error(`Swap not found: ${swapId}`);
    }

    switch (message.type) {
      case 'keys_exchange':
        await this.handleKeysExchange(session, message);
        break;
      case 'btc_locked':
        await this.handleBtcLocked(session, message);
        break;
      case 'xmr_locked':
        await this.handleXmrLocked(session, message);
        break;
      case 'xmr_claimed':
        await this.handleXmrClaimed(session, message);
        break;
      case 'btc_claimed':
        await this.handleBtcClaimed(session, message);
        break;
      case 'cancel':
        await this.handleCancel(session, message);
        break;
      case 'error':
        await this.handleError(session, message);
        break;
    }
  }

  /**
   * Handle key exchange message
   */
  private async handleKeysExchange(
    session: SwapSession,
    message: Extract<SwapMessage, { type: 'keys_exchange' }>
  ): Promise<void> {
    session.counterparty.btcPubkey = message.btcPubkey;
    session.counterparty.xmrViewKey = message.xmrViewKey;
    session.counterparty.adaptorPoint = message.adaptorPoint;

    session.timestamps.keysExchangedAt = Date.now();
    this.transition(session.swapId, SwapState.KEYS_EXCHANGED);
  }

  /**
   * Handle BTC locked message
   */
  private async handleBtcLocked(
    session: SwapSession,
    message: Extract<SwapMessage, { type: 'btc_locked' }>
  ): Promise<void> {
    session.transactions.btcLockTxid = message.txid;
    session.timestamps.btcLockedAt = Date.now();

    this.transition(session.swapId, SwapState.BTC_LOCKED);
    this.emit({
      type: 'btc_locked',
      swapId: session.swapId,
      txid: message.txid,
      confirmations: 0,
    });
  }

  /**
   * Handle XMR locked message
   */
  private async handleXmrLocked(
    session: SwapSession,
    message: Extract<SwapMessage, { type: 'xmr_locked' }>
  ): Promise<void> {
    session.transactions.xmrLockTxid = message.txid;
    session.timestamps.xmrLockedAt = Date.now();

    this.transition(session.swapId, SwapState.XMR_LOCKED);
    this.emit({
      type: 'xmr_locked',
      swapId: session.swapId,
      txid: message.txid,
    });
  }

  /**
   * Handle XMR claimed message (reveals adaptor secret)
   */
  private async handleXmrClaimed(
    session: SwapSession,
    message: Extract<SwapMessage, { type: 'xmr_claimed' }>
  ): Promise<void> {
    session.transactions.xmrClaimTxid = message.txid;

    // Extract adaptor secret from the claim transaction
    // This allows the counterparty to claim BTC
    if (session.side === 'xmr_seller') {
      // We're the XMR seller, counterparty claimed XMR
      // We can now use the revealed secret to claim BTC
      session.localKeys.adaptorSecret = message.adaptorSecret;
    }

    session.timestamps.xmrClaimedAt = Date.now();
    this.transition(session.swapId, SwapState.XMR_CLAIMED);
  }

  /**
   * Handle BTC claimed message
   */
  private async handleBtcClaimed(
    session: SwapSession,
    message: Extract<SwapMessage, { type: 'btc_claimed' }>
  ): Promise<void> {
    session.transactions.btcClaimTxid = message.txid;
    session.timestamps.btcClaimedAt = Date.now();
    session.timestamps.completedAt = Date.now();

    this.transition(session.swapId, SwapState.BTC_CLAIMED);
    this.transition(session.swapId, SwapState.COMPLETED);

    this.emit({ type: 'swap_completed', session });
  }

  /**
   * Handle cancel message
   */
  private async handleCancel(
    session: SwapSession,
    message: Extract<SwapMessage, { type: 'cancel' }>
  ): Promise<void> {
    session.error = {
      code: SwapErrorCode.USER_CANCELLED,
      message: message.reason,
      recoverable: false,
    };

    session.timestamps.cancelledAt = Date.now();
    this.transition(session.swapId, SwapState.CANCELLED);
  }

  /**
   * Handle error message
   */
  private async handleError(
    session: SwapSession,
    message: Extract<SwapMessage, { type: 'error' }>
  ): Promise<void> {
    session.error = {
      code: message.code,
      message: message.message,
      recoverable: false,
    };

    this.transition(session.swapId, SwapState.FAILED);
    this.emit({
      type: 'swap_failed',
      session,
      error: session.error,
    });
  }

  /**
   * Cancel a swap
   */
  async cancelSwap(swapId: SwapId, reason: string): Promise<void> {
    const session = this.swaps.get(swapId);
    if (!session) {
      throw new Error(`Swap not found: ${swapId}`);
    }

    // Can only cancel before funds are locked
    const cancellableStates: SwapState[] = [
      SwapState.CREATED,
      SwapState.OFFER_PUBLISHED,
      SwapState.OFFER_TAKEN,
      SwapState.KEYS_EXCHANGING,
      SwapState.KEYS_EXCHANGED,
      SwapState.AWAITING_BTC_LOCK,
    ];

    if (!cancellableStates.includes(session.state)) {
      throw new Error(`Cannot cancel swap in state: ${session.state}`);
    }

    session.error = {
      code: SwapErrorCode.USER_CANCELLED,
      message: reason,
      recoverable: false,
    };

    session.timestamps.cancelledAt = Date.now();
    this.transition(swapId, SwapState.CANCELLED);
  }

  /**
   * Trigger refund for a swap
   */
  async triggerRefund(swapId: SwapId): Promise<void> {
    const session = this.swaps.get(swapId);
    if (!session) {
      throw new Error(`Swap not found: ${swapId}`);
    }

    // Check if timelock has expired
    const now = Date.now() / 1000;

    if (session.side === 'btc_seller') {
      // We locked BTC, check BTC refund timelock
      if (now < session.timelocks.btcRefundTime) {
        throw new Error(
          `BTC refund timelock not expired. Wait ${session.timelocks.btcRefundTime - now} seconds`
        );
      }

      this.transition(swapId, SwapState.AWAITING_BTC_REFUND);
      this.emit({ type: 'refund_triggered', swapId, asset: 'BTC' });
    } else {
      // We locked XMR, check XMR refund timelock
      if (now < session.timelocks.xmrRefundTime) {
        throw new Error(
          `XMR refund timelock not expired. Wait ${session.timelocks.xmrRefundTime - now} seconds`
        );
      }

      this.transition(swapId, SwapState.AWAITING_XMR_REFUND);
      this.emit({ type: 'refund_triggered', swapId, asset: 'XMR' });
    }
  }

  /**
   * Get swap session
   */
  getSwap(swapId: SwapId): SwapSession | undefined {
    return this.swaps.get(swapId);
  }

  /**
   * Get all swaps
   */
  getAllSwaps(): SwapSession[] {
    return Array.from(this.swaps.values());
  }

  /**
   * Estimate fees for a swap
   * @param _btcAmount - BTC amount in satoshis (reserved for dynamic fee calculation)
   * @param _xmrAmount - XMR amount in piconeros (reserved for dynamic fee calculation)
   */
  estimateFees(_btcAmount: bigint, _xmrAmount: bigint): SwapFeeEstimate {
    // These are rough estimates - would use actual fee estimation in production
    // In the future, btcAmount and xmrAmount would be used for dynamic fee calculation
    // based on UTXO consolidation needs and XMR ring size requirements
    const btcFeeRate = 10; // sat/vbyte
    const btcLockSize = 250; // vbytes
    const btcClaimSize = 200;
    const btcRefundSize = 200;

    const xmrFee = 100000000n; // 0.0001 XMR in piconeros

    return {
      btcLockFee: BigInt(btcFeeRate * btcLockSize),
      btcClaimFee: BigInt(btcFeeRate * btcClaimSize),
      btcRefundFee: BigInt(btcFeeRate * btcRefundSize),
      xmrLockFee: xmrFee,
      xmrClaimFee: xmrFee,
      totalWorstCase: {
        btc: BigInt(btcFeeRate * (btcLockSize + btcRefundSize)),
        xmr: xmrFee,
      },
      totalHappyPath: {
        btc: BigInt(btcFeeRate * btcClaimSize),
        xmr: xmrFee * 2n,
      },
      btcFeeRate,
      xmrFeeMultiplier: 1,
    };
  }
}

// ============================================================================
// Watchtower Client
// ============================================================================

export class WatchtowerClient {
  private registrations: Map<SwapId, WatchtowerRegistration> = new Map();

  /**
   * Register a swap with watchtower for monitoring
   */
  async register(params: {
    swapId: SwapId;
    btcLockTxid: string;
    btcRefundTx: string;
    btcRefundTime: number;
    xmrLockTxid?: string;
    watchtowerEndpoint: OnionAddress;
  }): Promise<WatchtowerReceipt> {
    const registration: WatchtowerRegistration = {
      swapId: params.swapId,
      btcLockTxid: params.btcLockTxid,
      btcRefundTx: params.btcRefundTx,
      btcRefundTime: params.btcRefundTime,
      xmrLockTxid: params.xmrLockTxid,
      watchtowerEndpoint: params.watchtowerEndpoint,
      registeredAt: Date.now(),
      feePaid: 0n, // Would be actual fee in production
    };

    this.registrations.set(params.swapId, registration);

    // In production, this would connect to watchtower over Tor
    // and submit the registration
    const receipt: WatchtowerReceipt = {
      registrationId: randomHex(16),
      signature: randomHex(64), // Would be actual signature
      monitoringUntil: params.btcRefundTime + 3600, // Monitor 1 hour after timelock
    };

    return receipt;
  }

  /**
   * Cancel watchtower monitoring
   */
  async cancel(swapId: SwapId): Promise<void> {
    this.registrations.delete(swapId);
  }

  /**
   * Get registration status
   */
  getRegistration(swapId: SwapId): WatchtowerRegistration | undefined {
    return this.registrations.get(swapId);
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create DEX service with default or custom config
 */
export function createDexService(config: Partial<DexConfig> = {}): SwapManager {
  const fullConfig: DexConfig = {
    btcNetwork: config.btcNetwork ?? 'mainnet',
    xmrNetwork: config.xmrNetwork ?? 'mainnet',
    torEnabled: config.torEnabled ?? true,
    torProxy: config.torProxy,
    defaultOfferExpiry: config.defaultOfferExpiry ?? 600,
    defaultLockTimeout: config.defaultLockTimeout ?? 14400,
    btcRefundBlocks: config.btcRefundBlocks ?? 144,
    xmrRefundBlocks: config.xmrRefundBlocks ?? 1440,
    btcMinConfirmations: config.btcMinConfirmations ?? 1,
    xmrMinConfirmations: config.xmrMinConfirmations ?? 10,
    offerPowDifficulty: config.offerPowDifficulty ?? 20,
    watchtowers: config.watchtowers,
    btcRpc: config.btcRpc,
    xmrRpc: config.xmrRpc,
  };

  return new SwapManager(fullConfig);
}
