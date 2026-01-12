/**
 * Rail Gun - Libsodium Type Helpers
 * 
 * Provides typed interop for libsodium-wrappers that handles both ESM and CJS imports.
 * This eliminates the need for `any` casts throughout the codebase.
 */

import type libsodium from 'libsodium-wrappers';

/**
 * The properly typed libsodium module.
 */
export type SodiumModule = typeof libsodium;

/**
 * Module shape that accounts for both ESM namespace and CJS exports.
 * ESM: import * as sodium → { default: SodiumModule, ...SodiumModule }
 * CJS: require('libsodium-wrappers') → SodiumModule
 */
interface SodiumModuleImport {
  default?: SodiumModule;
  ready?: Promise<void>;
  [key: string]: unknown;
}

/**
 * Resolves the libsodium module from either ESM or CJS import.
 * Use this instead of casting to `any`.
 * 
 * @example
 * ```typescript
 * import * as sodiumModule from 'libsodium-wrappers';
 * const sodium = resolveSodiumModule(sodiumModule);
 * await sodium.ready;
 * ```
 */
export function resolveSodiumModule(imported: SodiumModuleImport): SodiumModule {
  // ESM namespace import has a default property
  if (imported.default && typeof imported.default === 'object') {
    return imported.default as SodiumModule;
  }
  // CJS or direct import - the module itself is the export
  return imported as unknown as SodiumModule;
}

/**
 * Dynamically imports and resolves libsodium, ensuring it's ready.
 * Handles both ESM and CJS environments automatically.
 * 
 * @example
 * ```typescript
 * const sodium = await loadSodium();
 * const key = sodium.crypto_secretbox_keygen();
 * ```
 */
export async function loadSodium(): Promise<SodiumModule> {
  const sodiumModule = await import('libsodium-wrappers');
  const sodium = resolveSodiumModule(sodiumModule as SodiumModuleImport);
  await sodium.ready;
  return sodium;
}
