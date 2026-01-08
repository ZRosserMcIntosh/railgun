import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Use jsdom for DOM APIs like MessageEvent, CustomEvent, etc.
    environment: 'jsdom',
    
    // Setup file for WebCrypto polyfill and other globals
    setupFiles: ['./src/test/setup.ts'],
    
    // Global test timeout (30 seconds for slow tests)
    testTimeout: 30000,
    
    // Hook timeout
    hookTimeout: 10000,
    
    // Include test patterns
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    
    // Exclude integration/load tests by default (require backend)
    exclude: [
      'node_modules/**',
      'dist/**',
      'src/**/*.integration.test.ts',
      'src/**/load.test.ts',
    ],
    
    // Coverage settings
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'src/test/**',
        '**/*.d.ts',
      ],
    },
    
    // Reporter
    reporters: ['default'],
    
    // Globals (describe, it, expect, etc.)
    globals: true,
  },
  
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'libsodium-wrappers': path.resolve(__dirname, '../../node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js'),
    },
  },
});
