# Rail Gun Pro Entitlement Token Specification

## Overview

Rail Gun Pro uses cryptographically signed entitlement tokens to verify subscription status offline. This eliminates the need for a central server to validate Pro access during normal app operation.

## Design Principles

1. **Offline-First**: Tokens are fully verifiable without network access
2. **Decentralized**: No central server required for validation
3. **Portable**: Users can export/import tokens across devices
4. **Cryptographically Secure**: Ed25519 signatures prevent forgery
5. **Identity-Bound**: Tokens are tied to user's public key identity

## Token Format

### Structure

```typescript
interface EntitlementToken {
  // === Payload (signed data) ===
  payload: {
    // Token schema version (for future upgrades)
    version: 1;
    
    // User's public identity key (base64)
    // Token is only valid for this identity
    sub: string;
    
    // Plan type
    plan: 'PRO';
    
    // Billing cycle
    billingPeriod: 'monthly' | 'annual';
    
    // When token was issued (Unix timestamp, seconds)
    issuedAt: number;
    
    // When token expires (Unix timestamp, seconds)
    expiresAt: number;
    
    // Capabilities granted (or derived from plan)
    features: Capability[];
    
    // Unique token identifier (UUID v4)
    tokenId: string;
  };
  
  // === Signature ===
  // Ed25519 signature of JSON-serialized payload (base64)
  signature: string;
}
```

### Serialized Format

Tokens are stored and transferred as a single string:

```
RAILGUN_PRO_V1.<base64url-encoded-payload>.<base64url-encoded-signature>
```

This format is:
- URL-safe (can be used in deep links)
- Easy to copy/paste
- Self-describing with version prefix
- Cannot be confused with other data types

### Example Token

```
RAILGUN_PRO_V1.eyJ2ZXJzaW9uIjoxLCJzdWIiOiJCUm....<signature>
```

## Capabilities

```typescript
enum Capability {
  HD_MEDIA = 'HD_MEDIA',           // High-resolution images
  LARGE_FILES = 'LARGE_FILES',     // Files > 100MB
  VIDEO_CALLING = 'VIDEO_CALLING', // Video calls (not just voice)
  LONG_VIDEO = 'LONG_VIDEO',       // Videos > 60 seconds
  SCREEN_SHARE = 'SCREEN_SHARE',   // Screen sharing (future)
  PRIORITY_RELAY = 'PRIORITY_RELAY', // Priority relay access (future)
}
```

### Plan → Capabilities Mapping

| Plan | Capabilities |
|------|-------------|
| FREE | None (basic features only) |
| PRO | HD_MEDIA, LARGE_FILES, VIDEO_CALLING, LONG_VIDEO |

## Thresholds

```typescript
const FREE_TIER_LIMITS = {
  // Images: max dimension before requiring Pro
  MAX_IMAGE_DIMENSION: 1280, // pixels
  
  // Videos: max duration before requiring Pro
  MAX_VIDEO_SECONDS: 60,
  
  // Files: max size before requiring Pro
  MAX_FILE_BYTES: 100 * 1024 * 1024, // 100 MB
  
  // Calls: video calling requires Pro
  // Free users can only do voice calls
  VIDEO_CALLING_ALLOWED: false,
};
```

## Verification Process

### 1. Parse Token

```typescript
function parseToken(tokenString: string): { payload: string; signature: string } | null {
  // Must start with correct prefix
  if (!tokenString.startsWith('RAILGUN_PRO_V1.')) {
    return null;
  }
  
  const parts = tokenString.slice('RAILGUN_PRO_V1.'.length).split('.');
  if (parts.length !== 2) {
    return null;
  }
  
  return {
    payload: parts[0],
    signature: parts[1],
  };
}
```

### 2. Verify Signature

```typescript
function verifySignature(
  payloadBase64: string,
  signatureBase64: string,
  publicKey: Uint8Array
): boolean {
  const payload = base64urlDecode(payloadBase64);
  const signature = base64urlDecode(signatureBase64);
  
  return ed25519.verify(signature, payload, publicKey);
}
```

### 3. Validate Payload

```typescript
function validatePayload(
  payload: EntitlementPayload,
  userIdentityKey: string,
  currentTime: number
): ValidationResult {
  // Version check
  if (payload.version !== 1) {
    return { valid: false, reason: 'UNSUPPORTED_VERSION' };
  }
  
  // Identity binding
  if (payload.sub !== userIdentityKey) {
    return { valid: false, reason: 'IDENTITY_MISMATCH' };
  }
  
  // Expiration with grace period (5 minutes for clock skew)
  const CLOCK_SKEW_GRACE = 5 * 60; // seconds
  if (currentTime > payload.expiresAt + CLOCK_SKEW_GRACE) {
    return { valid: false, reason: 'EXPIRED' };
  }
  
  // Not-before check (with grace)
  if (currentTime < payload.issuedAt - CLOCK_SKEW_GRACE) {
    return { valid: false, reason: 'NOT_YET_VALID' };
  }
  
  return { valid: true };
}
```

## Security Considerations

### Signing Key Management

- **Private Key**: NEVER stored in client code or repo
  - Stored offline in hardware security module or air-gapped machine
  - Used only by the token issuance service
  
- **Public Key**: Embedded in client
  - Hard-coded constant (not fetched from network)
  - Version-controlled in repository
  - Updated via app releases for key rotation

### Key Rotation

Key rotation procedure:
1. Generate new Ed25519 keypair offline
2. Embed new public key in next app version
3. New tokens issued with new private key
4. Old tokens remain valid until expiration
5. App accepts signatures from both old and new keys during transition

```typescript
// Multiple public keys for rotation periods
const ENTITLEMENT_PUBLIC_KEYS = [
  // Current key
  'OKP:Ed25519:<base64-current-key>',
  // Previous key (for tokens issued before rotation)
  'OKP:Ed25519:<base64-previous-key>',
];
```

### Attack Mitigations

| Attack | Mitigation |
|--------|------------|
| Token forgery | Ed25519 signature verification |
| Token theft | Bound to user's identity key |
| Replay across users | `sub` field verification |
| Clock manipulation | Grace window limits abuse potential |
| Token sharing | Identity binding makes sharing useless |
| Binary patching | Gates are defense-in-depth, not DRM |

## Token Lifecycle

### Acquisition

1. User initiates purchase via payment UI
2. Payment processed by Stripe (or crypto gateway)
3. Server mints signed token with user's identity key
4. Token delivered via:
   - Deep link: `railgun://pro/activate?token=...`
   - File download: `railgun_pro.token`
   - Copy/paste: Token string

### Storage

```typescript
// Stored in secure OS storage (Keychain/DPAPI/libsecret)
const TOKEN_STORAGE_KEY = 'railgun_pro_entitlement';

// Also exportable to file for backup/transfer
// File extension: .railgun-token
```

### Refresh

1. Token nears expiration (e.g., 7 days before)
2. If auto-renew enabled, payment processes
3. New token issued and delivered
4. Old token replaced

### Expiration

1. Token expiration time passes
2. App detects expired token on next capability check
3. User downgraded to Free tier
4. UI prompts for renewal

## Pricing

| Plan | Price | Duration | Features |
|------|-------|----------|----------|
| Pro Monthly | $7/month | 30 days | All Pro capabilities |
| Pro Annual | $77/year | 365 days | All Pro capabilities + 2 months free |

## Deep Link Schema

```
railgun://pro/activate?token=RAILGUN_PRO_V1.xxxxx.yyyyy
```

Query parameters:
- `token`: Full token string

## File Format

Extension: `.railgun-token`
MIME type: `application/x-railgun-token`

Contents: Raw token string (UTF-8)

## Relay Integration (Future)

For P2P relays that need to verify Pro status:

1. Client sends token as part of relay connection handshake
2. Relay verifies signature using same public key
3. Relay grants priority bandwidth/routes to Pro users
4. Relay never stores tokens (stateless verification)

## Version History

| Version | Changes |
|---------|---------|
| 1 | Initial specification |

## References

- Ed25519: https://ed25519.cr.yp.to/
- RFC 8037: CFRG Elliptic Curve Diffie-Hellman (ECDH) and Signatures in JOSE
- Base64URL: RFC 4648 Section 5
