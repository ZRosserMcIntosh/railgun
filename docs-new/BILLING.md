# Rail Gun Billing & Monetization

Last updated: December 28, 2025

Documentation for Rail Gun Pro subscriptions, entitlement tokens, and the billing system.

---

## Table of Contents

1. [Overview](#overview)
2. [Pro Features](#pro-features)
3. [Entitlement Tokens](#entitlement-tokens)
4. [Stripe Integration](#stripe-integration)
5. [Key Management](#key-management)
6. [Operational Procedures](#operational-procedures)

---

## Overview

Rail Gun uses a **pseudonymous billing system** that preserves user privacy while enabling Pro subscriptions.

### Design Principles

1. **Offline-First**: Tokens verifiable without network access
2. **Decentralized**: No central server for validation
3. **Portable**: Export/import tokens across devices
4. **Privacy-Preserving**: HMAC-based billing references (no direct user link)
5. **Cryptographically Secure**: Ed25519 signatures prevent forgery

---

## Pro Features

### Free vs Pro Comparison

| Feature | Free | Pro |
|---------|------|-----|
| **Messaging** | Unlimited | Unlimited |
| **Voice Chat** | 8 participants, 32kbps | 25 participants, 64kbps |
| **Video Calling** | ❌ | ✅ 720p+ |
| **Screen Sharing** | ❌ | ✅ |
| **File Uploads** | 25 MB max | 100 MB max |
| **Image Quality** | Standard | High resolution |
| **DEX Fees** | 1.0% | 0.3% |
| **API Access** | ❌ | ✅ |

### Capabilities Enum

```typescript
enum Capability {
  HD_MEDIA = 'HD_MEDIA',           // High-resolution images
  LARGE_FILES = 'LARGE_FILES',     // Files > 25MB
  VIDEO_CALLS = 'VIDEO_CALLS',     // Video + screen share
  HD_AUDIO = 'HD_AUDIO',           // 64kbps audio
  EXTENDED_VOICE = 'EXTENDED_VOICE', // 25 participants
  DEX_REDUCED_FEE = 'DEX_REDUCED_FEE', // 0.3% swap fee
  API_ACCESS = 'API_ACCESS',       // Developer API
}
```

---

## Entitlement Tokens

### Token Format

```
RAILGUN_PRO_V1.<base64url-payload>.<base64url-signature>
```

### Token Structure

```typescript
interface EntitlementToken {
  payload: {
    version: 1;
    sub: string;              // User's public identity key (base64)
    plan: 'PRO';
    billingPeriod: 'monthly' | 'annual';
    issuedAt: number;         // Unix timestamp
    expiresAt: number;        // Unix timestamp
    features: Capability[];
    tokenId: string;          // UUID v4
  };
  signature: string;          // Ed25519 signature (base64)
}
```

### Token Lifecycle

```
                                   ┌─────────────────┐
                                   │ Stripe Payment  │
                                   │   Success       │
                                   └────────┬────────┘
                                            │
                                            ▼
┌─────────────────┐              ┌─────────────────────┐
│   User Device   │◄─────────────│   Token Generation  │
│                 │  Token       │   (Offline Signer)  │
│  Store locally  │              └─────────────────────┘
│  in Keychain    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Token Verify   │
│  (Client-side)  │
│                 │
│ Check signature │
│ Check expiry    │
│ Check identity  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Unlock Features │
└─────────────────┘
```

### Verification Flow

```typescript
async function verifyEntitlement(token: string): Promise<boolean> {
  // 1. Parse token
  const [prefix, payloadB64, signatureB64] = token.split('.');
  if (prefix !== 'RAILGUN_PRO_V1') return false;
  
  // 2. Decode payload
  const payload = JSON.parse(base64Decode(payloadB64));
  
  // 3. Check expiry
  if (Date.now() / 1000 > payload.expiresAt) return false;
  
  // 4. Check identity matches current user
  if (payload.sub !== currentUser.identityPublicKey) return false;
  
  // 5. Verify signature against known public keys
  const signature = base64Decode(signatureB64);
  const payloadBytes = new TextEncoder().encode(payloadB64);
  
  for (const publicKey of ENTITLEMENT_PUBLIC_KEYS) {
    if (await verifyEd25519(payloadBytes, signature, publicKey)) {
      return true;
    }
  }
  
  return false;
}
```

---

## Stripe Integration

### Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────►│   API       │────►│   Stripe    │
│             │     │             │     │             │
│ Checkout    │     │ BillingServ │     │ Checkout    │
│ Session     │     │ ice         │     │ Sessions    │
└─────────────┘     └──────┬──────┘     └──────┬──────┘
                           │                    │
                           │                    │
                    ┌──────▼──────┐      ┌──────▼──────┐
                    │  Database   │      │  Webhooks   │
                    │             │◄─────│             │
                    │ billing_    │      │ payment     │
                    │ profiles    │      │ events      │
                    └─────────────┘      └─────────────┘
```

### Pseudonymous Billing

User identity is protected via HMAC billing references:

```typescript
function generateBillingRef(userId: string): string {
  // billing_ref = HMAC-SHA256(secret, `billing:${userId}`)[:16]
  const hmac = crypto.createHmac('sha256', BILLING_SECRET);
  hmac.update(`billing:${userId}`);
  return hmac.digest('hex').substring(0, 32);
}
```

Stripe only sees the `billing_ref`, not the actual user ID.

### Webhook Events

```typescript
// Handled webhook events
'checkout.session.completed'    // New subscription
'customer.subscription.updated' // Plan change
'customer.subscription.deleted' // Cancellation
'invoice.paid'                  // Renewal
'invoice.payment_failed'        // Payment failed
```

### API Endpoints

```
POST /billing/checkout          # Create Checkout session
POST /billing/portal            # Customer portal link
POST /billing/webhook           # Stripe webhooks
GET  /billing/status            # Current subscription status
```

---

## Key Management

### Signing Keypair

⚠️ **CRITICAL**: Private keys must be generated and stored OFFLINE.

#### Generate Keypair (Air-Gapped Machine)

```bash
cat > generate-keypair.js << 'EOF'
const sodium = require('libsodium-wrappers');

async function main() {
  await sodium.ready;
  const keypair = sodium.crypto_sign_keypair();
  
  console.log('PUBLIC KEY (embed in client):');
  console.log(sodium.to_base64(keypair.publicKey));
  console.log('');
  console.log('PRIVATE KEY (KEEP SECRET):');
  console.log(sodium.to_base64(keypair.privateKey));
}

main();
EOF

npm install libsodium-wrappers
node generate-keypair.js
```

#### Storage Requirements

| Key Type | Storage Location |
|----------|------------------|
| Private Key | Offline (USB, safe) |
| Public Key | Embedded in client |

#### Key Rotation

1. Generate new keypair on air-gapped machine
2. Add new public key to client (keep old one for transition)
3. Sign new tokens with new private key
4. After all old tokens expire, remove old public key

### Client Configuration

```typescript
// apps/desktop/src/billing/entitlement.ts
export const ENTITLEMENT_PUBLIC_KEYS: string[] = [
  // Current production key
  'BASE64_PUBLIC_KEY_HERE',
  
  // Previous key (keep for rotation period)
  'OLD_PUBLIC_KEY_HERE',
];
```

---

## Operational Procedures

### Generating a Token

```typescript
async function generateToken(
  userIdentityKey: string,
  plan: 'PRO',
  billingPeriod: 'monthly' | 'annual'
): Promise<string> {
  const payload = {
    version: 1,
    sub: userIdentityKey,
    plan,
    billingPeriod,
    issuedAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + (
      billingPeriod === 'annual' ? 365 * 24 * 60 * 60 : 30 * 24 * 60 * 60
    ),
    features: getCapabilitiesForPlan(plan),
    tokenId: crypto.randomUUID(),
  };
  
  const payloadB64 = base64Encode(JSON.stringify(payload));
  const signature = await signEd25519(payloadB64, PRIVATE_KEY);
  const signatureB64 = base64Encode(signature);
  
  return `RAILGUN_PRO_V1.${payloadB64}.${signatureB64}`;
}
```

### Revoking a Token

Tokens cannot be directly revoked (by design - offline verification). Options:

1. **Wait for expiry**: Tokens have limited lifetime
2. **Rotate keys**: Issue new tokens with new keypair
3. **Server-side blocklist**: Optional online check for high-value features

### Handling Subscription Cancellation

```typescript
// Webhook handler for subscription deleted
async handleSubscriptionDeleted(event: Stripe.Event) {
  const subscription = event.data.object;
  const billingRef = subscription.metadata.billing_ref;
  
  // Update database
  await this.billingProfileRepo.update(
    { billingRef },
    { status: 'CANCELLED', cancelledAt: new Date() }
  );
  
  // Token will continue working until expiry
  // No action needed client-side
}
```

### Pro Expiration During Use

If Pro expires mid-feature (e.g., during video call):

```typescript
// Voice/video: Graceful degradation
if (!hasCapability(Capability.VIDEO_CALLS)) {
  // Video stops, voice continues
  disableVideoStream();
  showNotification('Pro expired - video disabled');
}

// File upload: Reject oversized files
if (!hasCapability(Capability.LARGE_FILES) && file.size > 25_000_000) {
  throw new Error('File too large for free plan');
}
```
