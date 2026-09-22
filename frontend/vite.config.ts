import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

// The Midnight SDK ships WASM (onchain-runtime) that uses top-level await, and
// the compiled contract lives one directory up in ../contracts/managed. Vite 8
// (rolldown) with target 'esnext' supports top-level await natively, so no
// extra plugin is needed. Layout follows the official Midnight example dApps.
export default defineConfig({
  // GitHub Pages serves from /<repo>/; Vercel/Netlify from /. Set VITE_BASE at build time.
  base: process.env.VITE_BASE ?? '/',
  cacheDir: './.vite',
  server: {
    fs: { allow: ['..'] },
  },
  build: {
    target: 'esnext',
    minify: false,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('onchain-runtime-v3')) return 'wasm';
        },
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
      extensions: ['.js', '.cjs'],
      ignoreDynamicRequires: true,
    },
  },
  plugins: [
    react(),
    wasm(),
  ],
  optimizeDeps: {
    rolldownOptions: {
      platform: 'browser',
      moduleTypes: { '.wasm': 'binary' },
    },
    include: ['@midnight-ntwrk/compact-runtime'],
    exclude: [
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm_bg.wasm',
      '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm.js',
    ],
  },
  resolve: {
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.wasm'],
    mainFields: ['browser', 'module', 'main'],
  },
});
