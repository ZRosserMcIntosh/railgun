import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'process', 'stream'],
      globals: {
        Buffer: true,
        process: true,
      },
    }),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer({
      resolve: {
        '@signalapp/libsignal-client': { type: 'cjs' },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@railgun/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      // Use CommonJS build - ESM build is broken (missing libsodium.mjs)
      'libsodium-wrappers': path.resolve(__dirname, '../../node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      external: ['@signalapp/libsignal-client'],
    },
    commonjsOptions: {
      include: [/packages\/shared/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
  optimizeDeps: {
    include: ['@railgun/shared', 'libsodium-wrappers'],
    exclude: ['@signalapp/libsignal-client', 'node-gyp-build'],
    esbuildOptions: {
      // Force CommonJS handling for libsodium
      mainFields: ['main', 'module'],
    },
  },
});
