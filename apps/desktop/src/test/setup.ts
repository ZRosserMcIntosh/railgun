/**
 * Vitest Test Setup
 * 
 * This file runs before each test file and sets up:
 * 1. WebCrypto API (for Node.js environments)
 * 2. DOM globals that jsdom might miss
 * 3. Common mocks
 */

import { vi } from 'vitest';

// ============================================================================
// WebCrypto Setup
// ============================================================================

// Ensure WebCrypto is available globally
// Node 20+ has crypto.webcrypto, but we need it on globalThis.crypto
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('node:crypto');
    if (nodeCrypto.webcrypto) {
      // @ts-expect-error - assigning webcrypto to global
      globalThis.crypto = nodeCrypto.webcrypto;
    }
  } catch (e) {
    console.warn('[Test Setup] Could not set up WebCrypto:', e);
  }
}

// ============================================================================
// DOM Globals (for tests that use MessageEvent, etc.)
// ============================================================================

// MessageEvent might not be available in all jsdom versions
if (typeof globalThis.MessageEvent === 'undefined') {
  // @ts-expect-error - creating MessageEvent polyfill
  globalThis.MessageEvent = class MessageEvent extends Event {
    readonly data: unknown;
    readonly origin: string;
    readonly lastEventId: string;
    readonly source: MessageEventSource | null;
    readonly ports: ReadonlyArray<MessagePort>;

    constructor(type: string, eventInitDict?: MessageEventInit) {
      super(type, eventInitDict);
      this.data = eventInitDict?.data ?? null;
      this.origin = eventInitDict?.origin ?? '';
      this.lastEventId = eventInitDict?.lastEventId ?? '';
      this.source = eventInitDict?.source ?? null;
      this.ports = eventInitDict?.ports ? [...eventInitDict.ports] : [];
    }

    initMessageEvent(): void {
      // Legacy method, no-op
    }
  };
}

// DOMException should exist in Node 20+, but add fallback just in case
if (typeof globalThis.DOMException === 'undefined') {
  // @ts-expect-error - creating DOMException polyfill
  globalThis.DOMException = class DOMException extends Error {
    readonly code: number;
    readonly name: string;
    
    constructor(message?: string, name?: string) {
      super(message);
      this.name = name || 'Error';
      this.code = 0;
    }
  };
}

// ============================================================================
// Mock Electron APIs
// ============================================================================

// Mock window.electronAPI for tests running outside Electron
if (typeof window !== 'undefined' && !window.electronAPI) {
  // @ts-expect-error - mocking electronAPI
  window.electronAPI = {
    secureStore: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
    },
    app: {
      getVersion: vi.fn().mockReturnValue('0.1.0-test'),
      getPlatform: vi.fn().mockReturnValue('darwin'),
    },
    clipboard: {
      writeText: vi.fn(),
      readText: vi.fn().mockReturnValue(''),
    },
    shell: {
      openExternal: vi.fn(),
    },
  };
}

// ============================================================================
// Mock localStorage for tests
// ============================================================================

if (typeof window !== 'undefined' && !window.localStorage) {
  const store: Record<string, string> = {};
  // @ts-expect-error - mocking localStorage
  window.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() { return Object.keys(store).length; },
  };
}

// ============================================================================
// Suppress console noise in tests
// ============================================================================

// Optionally suppress console.warn/error during tests
// Uncomment if tests are too noisy
// vi.spyOn(console, 'warn').mockImplementation(() => {});
// vi.spyOn(console, 'error').mockImplementation(() => {});

// ============================================================================
// Global test utilities
// ============================================================================

// Helper to wait for async operations
export const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

// Helper to create a delay
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

console.log('[Test Setup] Environment initialized');
