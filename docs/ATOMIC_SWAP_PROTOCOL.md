# Rail Gun Decentralized Exchange: BTC ↔ XMR Atomic Swaps

## ⚠️ Security & Compliance Notice

This document describes a **non-custodial, peer-to-peer atomic swap system**. 

- **No funds are ever held by Rail Gun or any third party**
- All swap logic executes on-chain via cryptographic protocols
- Users maintain full custody throughout the swap
- **This is experimental software** - users assume all risk
- Consult local regulations regarding cryptocurrency exchanges

## Overview

Rail Gun enables trustless BTC ↔ XMR swaps using **adaptor signatures** and **hash time-locked contracts (HTLCs)**. This approach:

1. Requires no trusted third party
2. Ensures atomic settlement (both sides complete or neither does)
3. Preserves Monero's privacy guarantees
4. Operates over Tor/I2P for network-level anonymity

## Cryptographic Foundation

### The BTC-XMR Swap Challenge

Unlike BTC-BTC atomic swaps, BTC-XMR swaps are complex because:
- Monero lacks scripting capabilities (no native HTLCs)
- Monero transactions use ring signatures (unlinkable)

**Solution**: Adaptor signatures + view key revelation

### Protocol Overview (COMIT-style)

```
                    SWAP PROTOCOL FLOW
                    
    Alice (has BTC, wants XMR)     Bob (has XMR, wants BTC)
              │                              │
              │◄────── Offer (DHT) ──────────│
              │                              │
              ├─────── Accept ──────────────►│
              │                              │
              │   [Key Exchange Phase]       │
              │◄───── Bob's XMR view key ────│
              │◄───── Bob's adaptor point ───│
              ├───── Alice's BTC pubkey ────►│
              │                              │
              │   [Lock Phase]               │
              ├─── Lock BTC (2-of-2 + TL) ──►│ (Alice locks first)
              │                              │
              │◄──── Lock XMR (to Alice) ────┤ (Bob locks after seeing BTC)
              │                              │
              │   [Swap Phase]               │
              │   Alice sees XMR locked      │
              │   Alice reveals adaptor sig  │
              ├─── Claim XMR ───────────────►│
              │                              │
              │   Bob extracts secret from   │
              │   Alice's XMR claim tx       │
              │◄──────── Claim BTC ──────────┤
              │                              │
              │   [Complete - both happy]    │
              
    REFUND PATHS (if counterparty disappears):
    
    - Alice can reclaim BTC after timelock T₁ expires
    - Bob can reclaim XMR after timelock T₂ expires (T₂ > T₁)
```

## Technical Implementation

### 1. Swap Offer Structure

```typescript
interface SwapOffer {
  // Offer identity (ephemeral, per-swap)
  offerId: string;              // random 32 bytes
  
  // What the maker has
  makerAsset: 'BTC' | 'XMR';
  makerAmount: bigint;          // in satoshis or piconeros
  
  // What the maker wants
  takerAsset: 'BTC' | 'XMR';
  takerAmount: bigint;
  
  // Exchange rate (for display)
  rate: number;
  
  // Timing
  createdAt: number;
  expiresAt: number;            // offer validity (e.g., 10 min)
  lockTimeout: number;          // time for counterparty to lock
  
  // Network endpoints (Tor .onion only)
  contactEndpoint: string;      // e.g., "abc123.onion:9735"
  
  // Proof of funds (optional, privacy trade-off)
  proofOfFunds?: {
    type: 'btc_utxo_proof' | 'xmr_reserve_proof';
    data: string;
  };
  
  // Anti-spam
  powNonce: string;
  powDifficulty: number;
  
  // Signature (proves offer came from endpoint owner)
  signature: string;
}
```

### 2. Swap State Machine

```typescript
enum SwapState {
  // Initial
  CREATED = 'created',
  OFFER_PUBLISHED = 'offer_published',
  
  // Negotiation
  OFFER_TAKEN = 'offer_taken',
  KEYS_EXCHANGED = 'keys_exchanged',
  
  // Locking
  BTC_LOCKED = 'btc_locked',
  XMR_LOCKED = 'xmr_locked',
  
  // Settlement
  XMR_CLAIMED = 'xmr_claimed',      // Alice claimed XMR
  BTC_CLAIMED = 'btc_claimed',      // Bob claimed BTC
  COMPLETED = 'completed',
  
  // Failure paths
  CANCELLED = 'cancelled',
  BTC_REFUNDED = 'btc_refunded',
  XMR_REFUNDED = 'xmr_refunded',
  EXPIRED = 'expired',
}

interface SwapSession {
  swapId: string;
  state: SwapState;
  role: 'maker' | 'taker';
  
  // Amounts
  btcAmount: bigint;
  xmrAmount: bigint;
  
  // Keys (local, never transmitted except where required)
  localKeys: {
    btcPrivkey?: string;
    xmrSpendKey?: string;
    xmrViewKey?: string;
    adaptorSecret?: string;
  };
  
  // Counterparty info
  counterparty: {
    btcPubkey?: string;
    xmrViewKey?: string;
    adaptorPoint?: string;
  };
  
  // Transactions
  btcLockTxid?: string;
  xmrLockTxid?: string;
  btcClaimTxid?: string;
  xmrClaimTxid?: string;
  
  // Timelocks
  btcRefundTime: number;
  xmrRefundTime: number;
  
  // Timestamps
  createdAt: number;
  lockedAt?: number;
  completedAt?: number;
}
```

### 3. Bitcoin Lock Script

```typescript
// 2-of-2 multisig with timelock refund
function createBtcLockScript(
  alicePubkey: Buffer,
  bobPubkey: Buffer,
  refundTime: number
): Buffer {
  return bitcoin.script.compile([
    bitcoin.opcodes.OP_IF,
      // Happy path: 2-of-2 multisig
      bitcoin.opcodes.OP_2,
      alicePubkey,
      bobPubkey,
      bitcoin.opcodes.OP_2,
      bitcoin.opcodes.OP_CHECKMULTISIG,
    bitcoin.opcodes.OP_ELSE,
      // Refund path: Alice can reclaim after timelock
      bitcoin.script.number.encode(refundTime),
      bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
      bitcoin.opcodes.OP_DROP,
      alicePubkey,
      bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ENDIF,
  ]);
}
```

### 4. Adaptor Signature Flow

```typescript
// Alice creates adaptor signature (locks swap to her revealing the secret)
function createAdaptorSignature(
  message: Buffer,
  privateKey: Buffer,
  adaptorPoint: Buffer  // Bob's adaptor point (T = t*G)
): AdaptorSignature {
  // s' = k + e*x (but encrypted to adaptor point)
  // When Alice claims XMR, she reveals t
  // Bob can compute s = s' - t to get valid BTC signature
}

// Bob extracts secret when Alice claims XMR
function extractAdaptorSecret(
  adaptorSig: AdaptorSignature,
  completeSig: Signature
): Buffer {
  // t = s - s' (modular subtraction)
  return Buffer.from(subtractScalars(completeSig.s, adaptorSig.s_prime));
}
```

## Network Layer

### Tor-Only Communication

All swap negotiation occurs over Tor hidden services:

```typescript
interface SwapTransport {
  // Create ephemeral .onion for this swap session
  createHiddenService(): Promise<OnionAddress>;
  
  // Connect to counterparty's .onion
  connect(onionAddress: string): Promise<SwapConnection>;
  
  // Send encrypted message (noise protocol over Tor)
  send(msg: SwapMessage): Promise<void>;
  
  // Receive messages
  onMessage(handler: (msg: SwapMessage) => void): void;
}
```

### DHT Offer Discovery

Offers are broadcast via DHT gossip:

```typescript
interface OfferDiscovery {
  // Publish offer to DHT
  publishOffer(offer: SwapOffer): Promise<void>;
  
  // Subscribe to offers matching criteria
  subscribeOffers(filter: OfferFilter): AsyncIterable<SwapOffer>;
  
  // Remove offer (e.g., when taken)
  unpublishOffer(offerId: string): Promise<void>;
}

interface OfferFilter {
  makerAsset?: 'BTC' | 'XMR';
  minAmount?: bigint;
  maxAmount?: bigint;
  minRate?: number;
  maxRate?: number;
}
```

## Watchtower Service

Optional third-party watchers monitor for refund conditions:

```typescript
interface Watchtower {
  // Register swap for monitoring
  registerSwap(params: {
    btcLockTxid: string;
    btcRefundTx: string;       // Pre-signed refund transaction
    btcRefundTime: number;
    xmrLockTxid: string;
    xmrRefundKey?: string;     // Only if user trusts watchtower
  }): Promise<WatchtowerReceipt>;
  
  // Watchtower will broadcast refund if:
  // 1. Timelock expires
  // 2. Counterparty hasn't claimed
  // 3. User hasn't cancelled monitoring
}
```

**Privacy Note**: Watchtowers see refund transactions but not swap amounts or counterparty info if using separate watchtowers per swap.

## Anti-Spam & Reputation

### Offer Requirements

```typescript
interface OfferRequirements {
  // Minimum PoW to post offer
  minPowDifficulty: number;
  
  // Maximum offer lifetime
  maxOfferTTL: number;
  
  // Rate limits per Tor circuit
  maxOffersPerCircuit: number;
  maxOffersPerHour: number;
}
```

### Reputation (Optional)

For repeat traders, optional pseudonymous reputation:

```typescript
interface TraderReputation {
  // Blinded credential (unlinkable to identity)
  credential: BlindedCredential;
  
  // Completed swaps (count only, no details)
  completedSwaps: number;
  
  // Success rate
  successRate: number;
  
  // Average completion time
  avgCompletionTime: number;
}
```

## Security Considerations

### Timelock Selection

```
T_btc_refund < T_xmr_refund

Recommended:
- T_btc_refund = 24 hours (144 BTC blocks)
- T_xmr_refund = 48 hours (1440 XMR blocks)

This ensures Alice can refund BTC before Bob can refund XMR,
preventing Bob from getting both assets.
```

### Fee Estimation

```typescript
function estimateSwapFees(btcAmount: bigint, xmrAmount: bigint): SwapFees {
  return {
    // Bitcoin fees (lock + claim or refund)
    btcLockFee: estimateBtcFee(1, 1),      // ~250 vbytes
    btcClaimFee: estimateBtcFee(1, 1),     // ~200 vbytes
    btcRefundFee: estimateBtcFee(1, 1),    // ~200 vbytes
    
    // Monero fees (lock + claim)
    xmrLockFee: estimateXmrFee(),          // ~0.0001 XMR
    xmrClaimFee: estimateXmrFee(),         // ~0.0001 XMR
    
    // Total minimum (worst case: all refund)
    totalMinBtc: btcLockFee + btcRefundFee,
    totalMinXmr: xmrLockFee,
  };
}
```

### Attack Mitigations

| Attack | Mitigation |
|--------|------------|
| Free option (Alice locks BTC, waits for rate change) | Short lock timeout (2-4 hours) |
| Griefing (lock funds, never complete) | Reputation system + PoW cost |
| Front-running (see offer, race to take) | First-seen priority + atomic take |
| Eclipse (isolate peer in DHT) | Multiple DHT bootstrap nodes |
| Transaction malleability | Segwit BTC addresses only |

## Implementation Phases

### Phase 1: Manual Swaps
- CLI tool for advanced users
- Manual counterparty discovery
- Full logging for debugging

### Phase 2: Automated Matching
- DHT offer discovery
- Basic rate matching
- GUI integration

### Phase 3: Production
- Watchtower integration
- Reputation system
- Mobile support

## Code Example: Initiating a Swap

```typescript
import { SwapManager } from '@railgun/dex';

// Alice wants to swap BTC for XMR
const swap = await SwapManager.createSwap({
  role: 'maker',
  offerAsset: 'BTC',
  offerAmount: 10000000n,  // 0.1 BTC in satoshis
  wantAsset: 'XMR',
  wantAmount: 6500000000000n, // ~6.5 XMR in piconeros
  
  // Timeouts
  offerExpiry: 600,        // 10 min offer validity
  lockTimeout: 14400,      // 4 hour lock timeout
  
  // Network
  torEnabled: true,
});

// Publish offer
await swap.publishOffer();

// Wait for taker
swap.on('taken', async (counterparty) => {
  console.log('Swap taken, exchanging keys...');
});

swap.on('btc_locked', async () => {
  console.log('BTC locked, waiting for XMR...');
});

swap.on('xmr_locked', async () => {
  console.log('XMR locked, claiming...');
  await swap.claimXmr();
});

swap.on('completed', () => {
  console.log('Swap completed successfully!');
});

swap.on('refunded', (reason) => {
  console.log('Swap refunded:', reason);
});
```

## References

- [COMIT XMR-BTC Swap Research](https://comit.network/)
- [Monero Atomic Swaps](https://github.com/comit-network/xmr-btc-swap)
- [Bitcoin Adaptor Signatures](https://github.com/LLFourn/one-time-VES)
- [Farcaster Protocol](https://github.com/farcaster-project/farcaster-core)
