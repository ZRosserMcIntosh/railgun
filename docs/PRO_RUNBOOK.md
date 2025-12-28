# Rail Gun Pro - Developer Runbook

This document provides operational procedures for managing Rail Gun Pro subscriptions, entitlement tokens, and signing keys.

## Table of Contents

1. [Key Management](#key-management)
2. [Token Operations](#token-operations)
3. [Testing](#testing)
4. [Deployment](#deployment)
5. [Troubleshooting](#troubleshooting)

---

## Key Management

### Generating a New Signing Keypair

⚠️ **CRITICAL**: Private keys must be generated and stored OFFLINE. Never store private keys in:
- Source code repositories
- Cloud storage
- Development machines connected to the internet

#### Production Key Generation (Air-Gapped Machine)

```bash
# On an air-gapped machine with Node.js installed
# Create a temporary script:

cat > generate-keypair.js << 'EOF'
const sodium = require('libsodium-wrappers');

async function main() {
  await sodium.ready;
  
  const keypair = sodium.crypto_sign_keypair();
  
  console.log('=== RAIL GUN PRO SIGNING KEYPAIR ===');
  console.log('Generated:', new Date().toISOString());
  console.log('');
  console.log('PUBLIC KEY (embed in client):');
  console.log(sodium.to_base64(keypair.publicKey));
  console.log('');
  console.log('PRIVATE KEY (KEEP SECRET - OFFLINE ONLY):');
  console.log(sodium.to_base64(keypair.privateKey));
  console.log('');
  console.log('Fingerprint:', sodium.to_hex(
    sodium.crypto_generichash(8, keypair.publicKey)
  ).toUpperCase());
}

main();
EOF

npm install libsodium-wrappers
node generate-keypair.js
```

#### Storing the Private Key

1. Write the private key to a USB drive (encrypted)
2. Store in a secure physical location (safe, vault)
3. Consider using Shamir Secret Sharing for disaster recovery
4. Delete the key from the generation machine

#### Updating the Public Key in Client

Edit `apps/desktop/src/billing/entitlement.ts`:

```typescript
export const ENTITLEMENT_PUBLIC_KEYS: string[] = [
  // Current production key
  'NEW_PUBLIC_KEY_BASE64_HERE',
  
  // Previous key (keep for token rotation period)
  'OLD_PUBLIC_KEY_BASE64_HERE',
];
```

### Key Rotation Schedule

| Event | Action |
|-------|--------|
| Initial launch | Generate first keypair |
| Every 12 months | Generate new keypair, add to list |
| After 6 months rotation | Remove old key from list |
| Suspected compromise | Emergency rotation (see below) |

### Emergency Key Rotation

If a private key is compromised:

1. **Immediately** generate a new keypair
2. Update public key in client
3. Push emergency app update
4. Revoke all tokens signed with old key (by removing public key)
5. Notify affected users to re-activate
6. Investigate breach source

---

## Token Operations

### Minting Tokens for Testing

```typescript
// In Node.js or test environment
import { createEntitlementToken } from './apps/desktop/src/billing/entitlement';
import { Plan, BillingPeriod } from './apps/desktop/src/billing/capabilities';

// Your test keypair (NOT production!)
const TEST_PRIVATE_KEY = '...'; // Base64 private key
const userIdentityKey = '...'; // User's public identity key

const token = await createEntitlementToken(
  userIdentityKey,
  Plan.PRO,
  BillingPeriod.MONTHLY,
  30, // days
  TEST_PRIVATE_KEY
);

console.log('Token:', token);
```

### Production Token Minting Service

Create a secure backend service (example structure):

```typescript
// token-service/mint.ts (runs on secure server)

import { createEntitlementToken } from '@railgun/billing';
import { Plan, BillingPeriod } from '@railgun/billing';

// Load private key from secure environment (HSM, Vault, etc.)
const PRIVATE_KEY = process.env.ENTITLEMENT_SIGNING_KEY;

export async function mintProToken(
  userIdentityKey: string,
  billingPeriod: BillingPeriod
): Promise<string> {
  const durationDays = billingPeriod === BillingPeriod.MONTHLY ? 30 : 365;
  
  return createEntitlementToken(
    userIdentityKey,
    Plan.PRO,
    billingPeriod,
    durationDays,
    PRIVATE_KEY
  );
}
```

### Verifying a Token Manually

```typescript
import { verifyEntitlementToken, ENTITLEMENT_PUBLIC_KEYS } from '@railgun/billing';

const result = await verifyEntitlementToken(
  tokenString,
  userIdentityKey,
  undefined, // use current time
  ENTITLEMENT_PUBLIC_KEYS
);

if (result.valid) {
  console.log('Valid token!');
  console.log('Plan:', result.entitlement.plan);
  console.log('Expires:', new Date(result.entitlement.expiresAt * 1000));
} else {
  console.log('Invalid:', result.reason);
}
```

### Token Delivery Methods

1. **Deep Link** (recommended for web purchase):
   ```
   railgun://pro/activate?token=RAILGUN_PRO_V1.xxxxx.yyyyy
   ```

2. **File Download**:
   - Filename: `railgun_pro.railgun-token`
   - Content: Raw token string
   - MIME: `application/x-railgun-token`

3. **QR Code**:
   - Content: The token string
   - User scans with Rail Gun mobile app

4. **Manual Copy/Paste**:
   - Display token in web UI
   - User copies and pastes into app

---

## Testing

### Running Unit Tests

```bash
cd apps/desktop
pnpm test src/billing/__tests__/entitlement.test.ts
```

### Test Scenarios Checklist

- [ ] Valid token verifies correctly
- [ ] Expired token is rejected
- [ ] Token for wrong user is rejected
- [ ] Malformed token is rejected
- [ ] Wrong signature is rejected
- [ ] Clock skew within grace period works
- [ ] Clock skew outside grace period fails
- [ ] Key rotation accepts old key
- [ ] Key rotation rejects removed key

### Creating Test Users

```typescript
import { generateIdentityKeypair } from '@railgun/auth';

const testUser = await generateIdentityKeypair();
console.log('Test user public key:', testUser.publicKey);
```

### Local Development with Pro Features

For local development, you can either:

1. **Use test tokens**: Generate tokens with test keypair
2. **Mock the billing store**: Override `useBillingStore` in tests
3. **Environment flag**: `VITE_FORCE_PRO=true` (development only!)

```typescript
// In billingStore.ts (development only)
if (import.meta.env.VITE_FORCE_PRO === 'true') {
  // Return Pro capabilities regardless of token
}
```

---

## Deployment

### Pre-Release Checklist

- [ ] Production public key is set in `ENTITLEMENT_PUBLIC_KEYS`
- [ ] Test keypair is NOT in production code
- [ ] All gates are properly wired
- [ ] Free tier limits are correctly configured
- [ ] Pricing is correct ($7/mo, $77/yr)
- [ ] Payment integration is tested

### Payment Integration Setup

1. **Stripe Setup**:
   ```
   Create products:
   - Rail Gun Pro Monthly: $7/mo recurring
   - Rail Gun Pro Annual: $77/yr recurring
   ```

2. **Webhook Handler**:
   ```typescript
   // On successful payment:
   // 1. Get user's identity key from metadata
   // 2. Mint token
   // 3. Deliver token (email, deep link, or store for retrieval)
   ```

3. **Checkout Flow**:
   - App opens Stripe Checkout with user's identity key in metadata
   - After payment, backend mints token
   - Token delivered to user

### Monitoring

Track these metrics:

- Token verification success/failure rates
- Gate block events (which capabilities, how often)
- Token import success/failure rates
- Active Pro subscriptions

---

## Troubleshooting

### "Token signature is invalid"

1. Check if public key is correctly embedded in client
2. Verify token was signed with matching private key
3. Check for key rotation issues (old key removed too soon)
4. Ensure token string wasn't corrupted (no extra whitespace)

### "Token was issued for a different user"

1. User's identity key changed (new device, reset app)
2. Token was shared/stolen (expected behavior - not our user!)
3. User needs to re-purchase or transfer subscription

### "Token has expired"

1. Normal expiration - user needs to renew
2. Clock skew issue - check user's system time
3. If within grace period, should still work

### User Lost Their Token

1. If recurring subscription: re-mint and deliver
2. If one-time purchase: verify purchase, re-mint
3. Consider adding "token recovery" feature tied to payment receipt

### Gate Blocking Unexpectedly

1. Check `FREE_TIER_LIMITS` values
2. Verify entitlement loaded correctly
3. Check for expired token
4. Review gate logs: `getGateLogs()`

---

## Security Contacts

For security issues related to Pro subscriptions:
- Email: security@railgun.app
- PGP key: [link to key]

---

## Pseudonymous Billing Architecture

Rail Gun uses a privacy-preserving billing system that keeps user identity separate from payment information. This section documents the implementation.

### Core Principle: Surrogate Identifiers

We never send usernames or emails to Stripe. Instead, we use a **billing_ref** - a non-reversible surrogate ID:

```typescript
// billing_ref = HMAC(secret, user_id)
// This is ONE-WAY - cannot be reversed to get user_id
const billingRef = createHmac('sha256', BILLING_REF_SECRET)
  .update(userId)
  .digest('hex');
```

### Database Schema

```sql
-- billing_profiles table
CREATE TABLE billing_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL,           -- Link to auth system
  billing_ref VARCHAR(64) UNIQUE NOT NULL, -- HMAC surrogate
  stripe_customer_id VARCHAR(64),          -- Stripe Customer ID
  subscription_state VARCHAR(20) DEFAULT 'none',
  tier VARCHAR(20) DEFAULT 'free',
  stripe_subscription_id VARCHAR(64),
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for webhook lookups
CREATE INDEX idx_billing_ref ON billing_profiles(billing_ref);
CREATE INDEX idx_stripe_customer ON billing_profiles(stripe_customer_id);
```

### Stripe Integration Flow

#### 1. Creating a Customer (No PII)

```typescript
// When user enters billing, ensure Stripe customer exists
const customer = await stripe.customers.create({
  metadata: {
    billing_ref: profile.billingRef,  // ONLY identifier sent to Stripe
  },
  // NO email, NO name - just the surrogate
});
```

#### 2. Checkout Session

```typescript
const session = await stripe.checkout.sessions.create({
  customer: stripeCustomerId,
  client_reference_id: profile.billingRef,  // For webhook correlation
  mode: 'subscription',
  line_items: [{ price: priceId, quantity: 1 }],
  success_url: `${appUrl}/settings/billing?success=true`,
  cancel_url: `${appUrl}/settings/billing?canceled=true`,
});
```

#### 3. Webhook Handler

```typescript
// Handle checkout.session.completed
async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  // Look up by billing_ref - NOT by email
  const billingRef = session.client_reference_id;
  const profile = await this.getProfileByBillingRef(billingRef);
  
  // Update subscription state
  const subscription = await stripe.subscriptions.retrieve(session.subscription);
  await this.updateSubscriptionState(profile, subscription);
  
  // Log event ID only - never log PII
  this.logger.log(`Checkout completed: ${session.id}`);
}
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/billing/status` | GET | Get current subscription status |
| `/billing/has-pro` | GET | Check if user has Pro access |
| `/billing/checkout` | POST | Create Stripe Checkout session |
| `/billing/portal` | POST | Create Customer Portal session |
| `/billing/ephemeral-key` | POST | Get ephemeral key for mobile |
| `/webhooks/stripe` | POST | Handle Stripe webhooks |

### Mobile Integration

For iOS/Android using Stripe PaymentSheet:

```typescript
// 1. Get ephemeral key from backend
const { ephemeralKey, customerId } = await api.post('/billing/ephemeral-key', {
  stripeApiVersion: '2024-11-20.acacia',
});

// 2. Initialize PaymentSheet
await stripe.initPaymentSheet({
  customerId,
  customerEphemeralKeySecret: ephemeralKey,
  // ...
});
```

### Webhook Events Handled

| Event | Action |
|-------|--------|
| `checkout.session.completed` | New subscription started |
| `customer.subscription.updated` | Subscription changed |
| `customer.subscription.deleted` | Subscription ended |
| `invoice.payment_succeeded` | Payment collected |
| `invoice.payment_failed` | Payment failed - grace period |

### KYC (If Required)

Use Stripe Identity for verification without pulling PII:

```typescript
// Create verification session
const session = await stripe.identity.verificationSessions.create({
  type: 'document',
  metadata: { billing_ref: profile.billingRef },
});

// Store ONLY the verification status
profile.identityVerificationId = session.id;
profile.identityVerificationStatus = session.status;
// Do NOT store document images or extracted PII
```

### Data Hygiene Checklist

- [ ] No plaintext user identifiers in Stripe metadata
- [ ] No emails to Stripe unless using blind alias
- [ ] Logs redacted (no tokens, no Stripe IDs in plaintext)
- [ ] billing_ref columns encrypted at rest
- [ ] Access to billing_profiles table restricted
- [ ] Data retention policy defined
- [ ] Deletion/revocation playbook exists

### Environment Variables

```bash
# Required for billing
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
BILLING_REF_SECRET=your-32-byte-secret-key

# Price IDs
STRIPE_PRICE_PRO_MONTHLY=price_xxx
STRIPE_PRICE_PRO_YEARLY=price_xxx
STRIPE_PRICE_BUSINESS_MONTHLY=price_xxx
STRIPE_PRICE_BUSINESS_YEARLY=price_xxx

# App URL for redirects
APP_URL=https://railgun.app
```

### Testing Webhooks Locally

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3001/webhooks/stripe

# Trigger test events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
```

---

## Changelog

| Date | Change |
|------|--------|
| 2024-XX-XX | Initial Pro system implementation |
| 2024-XX-XX | Added pseudonymous billing architecture |

---

## Quick Reference

### Token Format
```
RAILGUN_PRO_V1.<base64url-payload>.<base64url-signature>
```

### Free Tier Limits
- Images: 1280px max dimension
- Videos: 60 seconds max
- Files: 100 MB max
- Calls: Voice only (no video)

### Pro Pricing
- Monthly: $7/month
- Annual: $77/year (save ~17%)

### Key Files
- `src/billing/capabilities.ts` - Limits and capability definitions
- `src/billing/entitlement.ts` - Token verification
- `src/stores/billingStore.ts` - Zustand store
- `src/lib/mediaGates.ts` - Gate hooks for media
- `docs/ENTITLEMENT_TOKEN_SPEC.md` - Full specification
