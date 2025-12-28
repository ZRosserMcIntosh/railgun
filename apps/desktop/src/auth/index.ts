/**
 * Rail Gun - Auth Module
 * 
 * Identity and authentication utilities.
 */

export {
  getIdentityPublicKey,
  computeUserId,
  getCurrentUserId,
  computeFingerprint,
  getCurrentFingerprint,
  identitiesMatch,
  generateIdentityKeypair,
  signWithIdentity,
  verifyIdentitySignature,
} from './identity';
