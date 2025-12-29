# Rail Gun Decentralized Exchange (DEX)

Last updated: December 28, 2025

Documentation for the built-in decentralized exchange functionality, including atomic swaps and privacy coin support.

---

## Table of Contents

1. [Overview](#overview)
2. [THORChain Integration](#thorchain-integration)
3. [Atomic Swap Protocol](#atomic-swap-protocol)
4. [Privacy Coin Support](#privacy-coin-support)
5. [Monetization](#monetization)
6. [Security & Compliance](#security--compliance)

---

## Overview

Rail Gun includes a non-custodial, peer-to-peer decentralized exchange for cryptocurrency swaps. Key properties:

- **Non-Custodial**: Funds never held by Rail Gun or any third party
- **Atomic**: Both sides complete or neither does
- **Privacy-Preserving**: Operates over Tor/I2P for anonymity
- **No KYC**: Username-only, no identity verification

### Current State

The DEX is currently a **UI mockup** that calculates swaps locally. Full implementation requires:
- Wallet integration layer
- Smart contract deployment
- Atomic swap protocol implementation

---

## THORChain Integration

### Why THORChain?

THORChain is a decentralized cross-chain liquidity protocol that:
- Supports native privacy coins (XMR, ZEC, DASH, FIRO)
- Enables trustless swaps without wrapped tokens
- Provides deep liquidity for major pairs

### Supported Chains

| Chain | Assets | Status |
|-------|--------|--------|
| Bitcoin | BTC | ✅ Supported |
| Ethereum | ETH, ERC-20s | ✅ Supported |
| Monero | XMR | ✅ Supported |
| Zcash | ZEC | ✅ Supported |
| Dash | DASH | ✅ Supported |
| Litecoin | LTC | ✅ Supported |

### Integration Architecture

```typescript
import { ThorchainSDK } from '@thorchain/sdk';

async function executeSwap(
  fromChain: string,
  toChain: string,
  amount: string,
  fromAddress: string,
  toAddress: string
) {
  const quote = await thorchain.getQuote({
    fromAsset: `${fromChain}.${fromChain}`,
    toAsset: `${toChain}.${toChain}`,
    amount,
  });
  
  // Execute via user's wallet (non-custodial)
  return thorchain.swap(quote);
}
```

---

## Atomic Swap Protocol

### BTC ↔ XMR Swaps

Bitcoin-Monero swaps are complex because Monero lacks scripting. We use **adaptor signatures** + **view key revelation**.

### Protocol Flow

```
Alice (has BTC, wants XMR)          Bob (has XMR, wants BTC)
         │                                    │
         │◄────── Offer (DHT) ────────────────│
         │                                    │
         ├─────── Accept ────────────────────►│
         │                                    │
         │   [Key Exchange Phase]             │
         │◄───── Bob's XMR view key ──────────│
         │◄───── Bob's adaptor point ─────────│
         ├───── Alice's BTC pubkey ──────────►│
         │                                    │
         │   [Lock Phase]                     │
         ├─── Lock BTC (2-of-2 + timelock) ──►│
         │                                    │
         │◄──── Lock XMR (to Alice) ──────────┤
         │                                    │
         │   [Swap Phase]                     │
         │   Alice sees XMR locked            │
         │   Alice reveals adaptor sig        │
         ├─── Claim XMR ─────────────────────►│
         │                                    │
         │   Bob extracts secret from         │
         │   Alice's XMR claim tx             │
         │◄──────── Claim BTC ────────────────┤
         │                                    │
         │   [Complete - both happy]          │
         
REFUND PATHS:
- Alice can reclaim BTC after timelock T₁
- Bob can reclaim XMR after timelock T₂ (T₂ > T₁)
```

### Swap Offer Structure

```typescript
interface SwapOffer {
  offerId: string;           // Random 32 bytes
  makerAsset: 'BTC' | 'XMR';
  takerAsset: 'BTC' | 'XMR';
  makerAmount: string;       // Satoshis or piconeros
  takerAmount: string;
  expiresAt: number;         // Unix timestamp
  
  // Crypto params
  makerPublicKey: string;    // For multisig
  adaptorPoint?: string;     // For XMR claims
  
  // Network
  onionAddress?: string;     // Tor address for P2P
  i2pAddress?: string;       // I2P address
}
```

### Hash Time-Locked Contracts (HTLC)

For Ethereum and EVM chains:

```solidity
contract AtomicSwap {
    struct Swap {
        address initiator;
        address participant;
        uint256 amount;
        bytes32 secretHash;
        uint256 lockTime;
        bool completed;
    }
    
    function initiateSwap(
        address participant,
        bytes32 secretHash,
        uint256 lockTime
    ) external payable;
    
    function completeSwap(
        bytes32 swapId,
        bytes32 secret
    ) external;
    
    function refund(bytes32 swapId) external;
}
```

---

## Privacy Coin Support

### The Challenge

Privacy coins have different architectures than Bitcoin/Ethereum:

| Coin | Wallet Type | Complexity |
|------|-------------|------------|
| **Monero (XMR)** | Ring signatures, stealth addresses | Hard |
| **Zcash (ZEC)** | Shielded (private) or transparent | Very Hard |
| **Dash** | PrivateSend mixing | Medium |
| **Firo** | Lelantus protocol | Medium |

### Solution: THORChain Native Support

THORChain handles privacy coin complexity internally:

```typescript
// Rail Gun just calls THORChain API
const swap = await thorchain.swap({
  fromAsset: 'XMR.XMR',
  toAsset: 'BTC.BTC',
  amount: '1000000000000',  // 1 XMR in piconeros
  destination: 'bc1q...',    // Bitcoin address
});
```

### Monero Specifics

For direct Monero integration (without THORChain):

```typescript
// Requires local Monero wallet RPC
const moneroWallet = new MoneroWalletRPC({
  host: 'localhost',
  port: 18082,
  username: 'rpc_user',
  password: 'rpc_password'
});

// Create transaction
const tx = await moneroWallet.createTx({
  accountIndex: 0,
  address: recipientAddress,
  amount: BigInt(amountInPiconeros)
});
```

---

## Monetization

### Fee Structure

| Fee Type | Amount | Description |
|----------|--------|-------------|
| THORChain fee | 0.25% | Native protocol fee |
| Platform fee | 0.5-1.0% | Rail Gun's margin |
| **Total** | 0.75-1.25% | User pays |

### Tiered Pricing

```typescript
interface FeeStructure {
  standardSwap: 1.0,      // < $10K
  largeSwap: 0.5,         // $10K - $100K
  whaleSwap: 0.3,         // > $100K
  privacyCoin: +0.5,      // Premium for XMR/ZEC
}
```

### Pro Subscription Benefits

| Feature | Free | Pro |
|---------|------|-----|
| Platform fee | 1.0% | 0.3% |
| Swaps per day | 10 | Unlimited |
| Max swap size | $10,000 | $1,000,000 |
| Smart routing | ❌ | ✅ |
| API access | ❌ | ✅ |

### Revenue Model

```typescript
// Example: $1,000 swap
const fees = {
  inputAmount: 1000,
  thorchainFee: 2.50,     // 0.25%
  platformFee: 10.00,     // 1.0%
  totalFee: 12.50,
  userReceives: 987.50,
  railgunRevenue: 10.00   // Your profit
};
```

---

## Security & Compliance

### ⚠️ Legal Notice

This is a **non-custodial, peer-to-peer system**:
- No funds held by Rail Gun
- All swap logic executes on-chain
- Users maintain full custody
- Consult local regulations

### Security Model

| Threat | Mitigation |
|--------|------------|
| Counterparty disappears | Timelocked refunds |
| Price manipulation | Short lock windows |
| Network surveillance | Tor/I2P transport |
| Replay attacks | Unique swap IDs, nonces |

### Audit Status

- [ ] Smart contract audit (pending)
- [ ] Protocol formal verification (pending)
- [x] THORChain (audited by third parties)

### Best Practices

1. **Start small**: Test with small amounts first
2. **Verify addresses**: Double-check all addresses
3. **Use Tor**: Enable Tor for swap negotiations
4. **Monitor timelocks**: Don't let refunds expire
5. **Keep records**: Save transaction IDs
