/**
 * Rail Gun Pro - Entitlement Token Tests
 * 
 * Tests for token verification, capabilities, and edge cases.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers';
import {
  verifyEntitlementToken,
  createEntitlementToken,
  generateSigningKeypair,
  parseTokenString,
  TOKEN_PREFIX,
  TOKEN_VERSION,
  CLOCK_SKEW_GRACE_SECONDS,
} from '../entitlement';
import {
  Capability,
  Plan,
  BillingPeriod,
  getCapabilities,
  hasCapability,
  getCurrentPlan,
  checkImageSend,
  checkVideoSend,
  checkFileSend,
  checkVideoCall,
  FREE_TIER_LIMITS,
  PLAN_CAPABILITIES,
} from '../capabilities';

// ============================================================================
// TEST FIXTURES
// ============================================================================

let testKeypair: { publicKey: string; privateKey: string };
let testIdentityKey: string;

beforeAll(async () => {
  await sodium.ready;
  
  // Generate test signing keypair
  testKeypair = await generateSigningKeypair();
  
  // Generate test user identity key
  const identityKp = sodium.crypto_sign_keypair();
  testIdentityKey = sodium.to_base64(identityKp.publicKey);
});

// ============================================================================
// TOKEN VERIFICATION TESTS
// ============================================================================

describe('Token Verification', () => {
  it('should verify a valid token', async () => {
    const token = await createEntitlementToken(
      testIdentityKey,
      Plan.PRO,
      BillingPeriod.MONTHLY,
      30,
      testKeypair.privateKey
    );
    
    const result = await verifyEntitlementToken(
      token,
      testIdentityKey,
      undefined,
      [testKeypair.publicKey]
    );
    
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.entitlement.plan).toBe(Plan.PRO);
      expect(result.entitlement.sub).toBe(testIdentityKey);
    }
  });
  
  it('should reject token with wrong signature', async () => {
    const token = await createEntitlementToken(
      testIdentityKey,
      Plan.PRO,
      BillingPeriod.MONTHLY,
      30,
      testKeypair.privateKey
    );
    
    // Use a different public key for verification
    const wrongKeypair = await generateSigningKeypair();
    
    const result = await verifyEntitlementToken(
      token,
      testIdentityKey,
      undefined,
      [wrongKeypair.publicKey]
    );
    
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('INVALID_SIGNATURE');
    }
  });
  
  it('should reject expired token', async () => {
    // Create a token that expired 1 day ago
    const now = Math.floor(Date.now() / 1000);
    
    const token = await createEntitlementToken(
      testIdentityKey,
      Plan.PRO,
      BillingPeriod.MONTHLY,
      -1, // Negative duration = already expired
      testKeypair.privateKey
    );
    
    // Manually adjust the verification time to be well past expiration
    const result = await verifyEntitlementToken(
      token,
      testIdentityKey,
      now + 3600, // 1 hour after issuance
      [testKeypair.publicKey]
    );
    
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('EXPIRED');
    }
  });
  
  it('should allow clock skew within grace period', async () => {
    const token = await createEntitlementToken(
      testIdentityKey,
      Plan.PRO,
      BillingPeriod.MONTHLY,
      30,
      testKeypair.privateKey
    );
    
    // Parse to get expiration
    const parsed = parseTokenString(token);
    expect(parsed).not.toBeNull();
    
    // Verify at exactly expiration + grace period - 1 second
    const result = await verifyEntitlementToken(
      token,
      testIdentityKey,
      parsed!.payload.expiresAt + CLOCK_SKEW_GRACE_SECONDS - 1,
      [testKeypair.publicKey]
    );
    
    expect(result.valid).toBe(true);
  });
  
  it('should reject token outside clock skew grace', async () => {
    const token = await createEntitlementToken(
      testIdentityKey,
      Plan.PRO,
      BillingPeriod.MONTHLY,
      30,
      testKeypair.privateKey
    );
    
    // Parse to get expiration
    const parsed = parseTokenString(token);
    expect(parsed).not.toBeNull();
    
    // Verify well past expiration + grace period
    const result = await verifyEntitlementToken(
      token,
      testIdentityKey,
      parsed!.payload.expiresAt + CLOCK_SKEW_GRACE_SECONDS + 60,
      [testKeypair.publicKey]
    );
    
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('EXPIRED');
    }
  });
  
  it('should reject token for wrong identity', async () => {
    const token = await createEntitlementToken(
      testIdentityKey,
      Plan.PRO,
      BillingPeriod.MONTHLY,
      30,
      testKeypair.privateKey
    );
    
    // Different identity
    const otherIdentityKp = sodium.crypto_sign_keypair();
    const otherIdentityKey = sodium.to_base64(otherIdentityKp.publicKey);
    
    const result = await verifyEntitlementToken(
      token,
      otherIdentityKey,
      undefined,
      [testKeypair.publicKey]
    );
    
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('IDENTITY_MISMATCH');
    }
  });
  
  it('should reject invalid token format', async () => {
    const result = await verifyEntitlementToken(
      'invalid-token-string',
      testIdentityKey,
      undefined,
      [testKeypair.publicKey]
    );
    
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('INVALID_PREFIX');
    }
  });
  
  it('should reject token with invalid prefix', async () => {
    const result = await verifyEntitlementToken(
      'WRONG_PREFIX.xxxxx.yyyyy',
      testIdentityKey,
      undefined,
      [testKeypair.publicKey]
    );
    
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('INVALID_PREFIX');
    }
  });
  
  it('should reject token with malformed payload', async () => {
    const result = await verifyEntitlementToken(
      `${TOKEN_PREFIX}not-valid-base64.signature`,
      testIdentityKey,
      undefined,
      [testKeypair.publicKey]
    );
    
    expect(result.valid).toBe(false);
  });
});

// ============================================================================
// TOKEN PARSING TESTS
// ============================================================================

describe('Token Parsing', () => {
  it('should parse valid token string', async () => {
    const token = await createEntitlementToken(
      testIdentityKey,
      Plan.PRO,
      BillingPeriod.ANNUAL,
      365,
      testKeypair.privateKey
    );
    
    const parsed = parseTokenString(token);
    
    expect(parsed).not.toBeNull();
    expect(parsed!.payload.version).toBe(TOKEN_VERSION);
    expect(parsed!.payload.plan).toBe(Plan.PRO);
    expect(parsed!.payload.billingPeriod).toBe(BillingPeriod.ANNUAL);
    expect(parsed!.payload.sub).toBe(testIdentityKey);
    expect(parsed!.signature).toBeTruthy();
  });
  
  it('should return null for invalid token', () => {
    expect(parseTokenString('not-a-token')).toBeNull();
    expect(parseTokenString('')).toBeNull();
    expect(parseTokenString(`${TOKEN_PREFIX}only-one-part`)).toBeNull();
  });
});

// ============================================================================
// CAPABILITY TESTS
// ============================================================================

describe('Capabilities', () => {
  it('should return empty capabilities for free tier', () => {
    const capabilities = getCapabilities(undefined);
    expect(capabilities.size).toBe(0);
  });
  
  it('should return Pro capabilities for valid entitlement', async () => {
    const token = await createEntitlementToken(
      testIdentityKey,
      Plan.PRO,
      BillingPeriod.MONTHLY,
      30,
      testKeypair.privateKey
    );
    
    const result = await verifyEntitlementToken(
      token,
      testIdentityKey,
      undefined,
      [testKeypair.publicKey]
    );
    
    expect(result.valid).toBe(true);
    if (result.valid) {
      const capabilities = getCapabilities(result.entitlement);
      
      expect(capabilities.has(Capability.HD_MEDIA)).toBe(true);
      expect(capabilities.has(Capability.LARGE_FILES)).toBe(true);
      expect(capabilities.has(Capability.VIDEO_CALLING)).toBe(true);
      expect(capabilities.has(Capability.LONG_VIDEO)).toBe(true);
    }
  });
  
  it('should return free capabilities for expired entitlement', async () => {
    const token = await createEntitlementToken(
      testIdentityKey,
      Plan.PRO,
      BillingPeriod.MONTHLY,
      30,
      testKeypair.privateKey
    );
    
    const parsed = parseTokenString(token);
    expect(parsed).not.toBeNull();
    
    // Simulate expired entitlement
    const expiredEntitlement = {
      ...parsed!.payload,
      expiresAt: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      features: Array.from(PLAN_CAPABILITIES[Plan.PRO]),
      tokenId: 'test-id',
    };
    
    const capabilities = getCapabilities(expiredEntitlement);
    expect(capabilities.size).toBe(0);
  });
  
  it('should check hasCapability correctly', async () => {
    // Free user
    expect(hasCapability(Capability.HD_MEDIA, undefined)).toBe(false);
    expect(hasCapability(Capability.VIDEO_CALLING, undefined)).toBe(false);
    
    // Pro user
    const token = await createEntitlementToken(
      testIdentityKey,
      Plan.PRO,
      BillingPeriod.MONTHLY,
      30,
      testKeypair.privateKey
    );
    
    const result = await verifyEntitlementToken(
      token,
      testIdentityKey,
      undefined,
      [testKeypair.publicKey]
    );
    
    if (result.valid) {
      expect(hasCapability(Capability.HD_MEDIA, result.entitlement)).toBe(true);
      expect(hasCapability(Capability.VIDEO_CALLING, result.entitlement)).toBe(true);
    }
  });
  
  it('should return correct plan for entitlement', async () => {
    expect(getCurrentPlan(undefined)).toBe(Plan.FREE);
    
    const token = await createEntitlementToken(
      testIdentityKey,
      Plan.PRO,
      BillingPeriod.MONTHLY,
      30,
      testKeypair.privateKey
    );
    
    const result = await verifyEntitlementToken(
      token,
      testIdentityKey,
      undefined,
      [testKeypair.publicKey]
    );
    
    if (result.valid) {
      expect(getCurrentPlan(result.entitlement)).toBe(Plan.PRO);
    }
  });
});

// ============================================================================
// GATE CHECK TESTS
// ============================================================================

describe('Gate Checks', () => {
  describe('Image Send', () => {
    it('should allow small images for free users', () => {
      const result = checkImageSend(800, 600, undefined);
      expect(result.allowed).toBe(true);
    });
    
    it('should allow images at exactly the limit', () => {
      const limit = FREE_TIER_LIMITS.MAX_IMAGE_DIMENSION;
      const result = checkImageSend(limit, limit / 2, undefined);
      expect(result.allowed).toBe(true);
    });
    
    it('should block large images for free users', () => {
      const limit = FREE_TIER_LIMITS.MAX_IMAGE_DIMENSION;
      const result = checkImageSend(limit + 1, 600, undefined);
      expect(result.allowed).toBe(false);
      expect(result.requiredCapability).toBe(Capability.HD_MEDIA);
    });
    
    it('should allow large images for Pro users', async () => {
      const token = await createEntitlementToken(
        testIdentityKey,
        Plan.PRO,
        BillingPeriod.MONTHLY,
        30,
        testKeypair.privateKey
      );
      
      const verifyResult = await verifyEntitlementToken(
        token,
        testIdentityKey,
        undefined,
        [testKeypair.publicKey]
      );
      
      if (verifyResult.valid) {
        const result = checkImageSend(4000, 3000, verifyResult.entitlement);
        expect(result.allowed).toBe(true);
      }
    });
  });
  
  describe('Video Send', () => {
    it('should allow short videos for free users', () => {
      const result = checkVideoSend(30, undefined);
      expect(result.allowed).toBe(true);
    });
    
    it('should allow videos at exactly the limit', () => {
      const limit = FREE_TIER_LIMITS.MAX_VIDEO_SECONDS;
      const result = checkVideoSend(limit, undefined);
      expect(result.allowed).toBe(true);
    });
    
    it('should block long videos for free users', () => {
      const limit = FREE_TIER_LIMITS.MAX_VIDEO_SECONDS;
      const result = checkVideoSend(limit + 1, undefined);
      expect(result.allowed).toBe(false);
      expect(result.requiredCapability).toBe(Capability.LONG_VIDEO);
    });
  });
  
  describe('File Send', () => {
    it('should allow small files for free users', () => {
      const result = checkFileSend(10 * 1024 * 1024, undefined); // 10 MB
      expect(result.allowed).toBe(true);
    });
    
    it('should allow files at exactly the limit', () => {
      const limit = FREE_TIER_LIMITS.MAX_FILE_BYTES;
      const result = checkFileSend(limit, undefined);
      expect(result.allowed).toBe(true);
    });
    
    it('should block large files for free users', () => {
      const limit = FREE_TIER_LIMITS.MAX_FILE_BYTES;
      const result = checkFileSend(limit + 1, undefined);
      expect(result.allowed).toBe(false);
      expect(result.requiredCapability).toBe(Capability.LARGE_FILES);
    });
  });
  
  describe('Video Call', () => {
    it('should block video calls for free users', () => {
      const result = checkVideoCall(undefined);
      expect(result.allowed).toBe(false);
      expect(result.requiredCapability).toBe(Capability.VIDEO_CALLING);
    });
    
    it('should allow video calls for Pro users', async () => {
      const token = await createEntitlementToken(
        testIdentityKey,
        Plan.PRO,
        BillingPeriod.MONTHLY,
        30,
        testKeypair.privateKey
      );
      
      const verifyResult = await verifyEntitlementToken(
        token,
        testIdentityKey,
        undefined,
        [testKeypair.publicKey]
      );
      
      if (verifyResult.valid) {
        const result = checkVideoCall(verifyResult.entitlement);
        expect(result.allowed).toBe(true);
      }
    });
  });
});

// ============================================================================
// KEY ROTATION TESTS
// ============================================================================

describe('Key Rotation', () => {
  it('should verify tokens with any valid key in the list', async () => {
    const oldKeypair = await generateSigningKeypair();
    const newKeypair = await generateSigningKeypair();
    
    // Token signed with old key
    const token = await createEntitlementToken(
      testIdentityKey,
      Plan.PRO,
      BillingPeriod.MONTHLY,
      30,
      oldKeypair.privateKey
    );
    
    // Verify with both keys in the list
    const result = await verifyEntitlementToken(
      token,
      testIdentityKey,
      undefined,
      [newKeypair.publicKey, oldKeypair.publicKey] // Old key is still in list
    );
    
    expect(result.valid).toBe(true);
  });
  
  it('should reject tokens if no matching key in list', async () => {
    const signingKeypair = await generateSigningKeypair();
    const wrongKeypair1 = await generateSigningKeypair();
    const wrongKeypair2 = await generateSigningKeypair();
    
    // Token signed with a key not in our list
    const token = await createEntitlementToken(
      testIdentityKey,
      Plan.PRO,
      BillingPeriod.MONTHLY,
      30,
      signingKeypair.privateKey
    );
    
    // Verify with different keys
    const result = await verifyEntitlementToken(
      token,
      testIdentityKey,
      undefined,
      [wrongKeypair1.publicKey, wrongKeypair2.publicKey]
    );
    
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('INVALID_SIGNATURE');
    }
  });
});
