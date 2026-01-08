/**
 * mediasoup Stub Module
 * 
 * Provides a stub implementation of mediasoup for environments where
 * the native module is not available (e.g., production containers without build tools).
 * 
 * To use the real mediasoup:
 * ```bash
 * pnpm add mediasoup@3
 * ```
 * 
 * This stub throws an error if called, allowing the application to start
 * and gracefully handle voice room initialization failures.
 */

class StubMediasoup {
  static async createWorker(options) {
    throw new Error(
      'mediasoup native module not installed. ' +
      'Install with: pnpm add mediasoup (requires build tools)',
    );
  }
}

module.exports = StubMediasoup;
