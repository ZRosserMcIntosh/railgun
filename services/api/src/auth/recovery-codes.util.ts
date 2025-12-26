import * as crypto from 'crypto';
import { RecoveryCodeHash } from '../users/user.entity';

/**
 * Recovery Code Utility Service
 * Handles generation, hashing, and verification of recovery codes
 * 
 * SECURITY NOTES:
 * - Recovery codes are NEVER stored in plaintext
 * - Each code has its own salt for additional security
 * - Codes are compared in constant time to prevent timing attacks
 * - Codes are formatted for user readability (XXXX-XXXX-XXXX)
 */

const RECOVERY_CODE_LENGTH = 12; // 12 chars before formatting
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0, O, 1, I to avoid confusion

/**
 * Generates a single random recovery code
 * Format: XXXX-XXXX-XXXX
 */
function generateSingleCode(): string {
  const bytes = crypto.randomBytes(RECOVERY_CODE_LENGTH);
  let code = '';
  
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
    code += RECOVERY_CODE_CHARSET[bytes[i] % RECOVERY_CODE_CHARSET.length];
  }
  
  // Format as XXXX-XXXX-XXXX
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

/**
 * Generate a random salt for a recovery code
 */
function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Hash a recovery code with its salt using HMAC-SHA256
 */
function hashCode(code: string, salt: string, secret: string): string {
  // Normalize code (remove dashes, uppercase)
  const normalizedCode = code.replace(/-/g, '').toUpperCase();
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(salt + normalizedCode);
  return hmac.digest('hex');
}

/**
 * Constant-time comparison of two strings
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export interface GeneratedRecoveryCodes {
  /** Plaintext codes to return to user (only time they're visible) */
  plaintextCodes: string[];
  /** Hashed codes to store in database */
  hashedCodes: RecoveryCodeHash[];
}

/**
 * Generate a new set of recovery codes
 * @param secret - The application secret used for HMAC
 * @param count - Number of codes to generate (default: 10)
 */
export function generateRecoveryCodes(
  secret: string,
  count: number = RECOVERY_CODE_COUNT
): GeneratedRecoveryCodes {
  const plaintextCodes: string[] = [];
  const hashedCodes: RecoveryCodeHash[] = [];
  
  for (let i = 0; i < count; i++) {
    const code = generateSingleCode();
    const salt = generateSalt();
    const hash = hashCode(code, salt, secret);
    
    plaintextCodes.push(code);
    hashedCodes.push({
      id: crypto.randomUUID(),
      hash,
      salt,
      used: false,
      createdAt: new Date(),
      usedAt: null,
    });
  }
  
  return { plaintextCodes, hashedCodes };
}

/**
 * Verify a recovery code against stored hashes
 * @param candidateCode - The code provided by the user
 * @param storedCodes - The array of stored hashed codes
 * @param secret - The application secret used for HMAC
 * @returns The matching code's ID if valid, null otherwise
 */
export function verifyRecoveryCode(
  candidateCode: string,
  storedCodes: RecoveryCodeHash[],
  secret: string
): string | null {
  // Normalize the candidate code
  const normalizedCandidate = candidateCode.replace(/-/g, '').toUpperCase();
  
  // Check each unused code
  for (const storedCode of storedCodes) {
    if (storedCode.used) {
      continue;
    }
    
    const candidateHash = hashCode(normalizedCandidate, storedCode.salt, secret);
    
    if (safeCompare(candidateHash, storedCode.hash)) {
      return storedCode.id;
    }
  }
  
  return null;
}

/**
 * Mark a recovery code as used
 * @param codes - The array of stored hashed codes
 * @param codeId - The ID of the code to mark as used
 * @returns Updated array of codes
 */
export function markCodeAsUsed(
  codes: RecoveryCodeHash[],
  codeId: string
): RecoveryCodeHash[] {
  return codes.map(code => {
    if (code.id === codeId) {
      return {
        ...code,
        used: true,
        usedAt: new Date(),
      };
    }
    return code;
  });
}

/**
 * Get count of remaining (unused) recovery codes
 */
export function getRemainingCodeCount(codes: RecoveryCodeHash[]): number {
  return codes.filter(code => !code.used).length;
}
