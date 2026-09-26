import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Production sends this policy from CloudFront; preview sends it too so the
// browser tests (e2e/) run under it. See e2e/csp.spec.ts.
const csp = readFileSync('../deploy/content-security-policy.txt', 'utf8').trim();

// The site must work from any sub-path (spec 02/06), so every emitted URL is
// relative to index.html. Asset inlining is disabled so the wasm module (and
// everything else the app fetches at runtime) always lands in dist/assets with
// a content-derived filename.
export default defineConfig({
  base: './',
  plugins: [preact()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  preview: { headers: { 'Content-Security-Policy': csp } },
  test: {
    environment: 'jsdom',
    // `?mockEngine` forces the mock engine so DOM tests never touch wasm.
    environmentOptions: { jsdom: { url: 'http://localhost/?mockEngine' } },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
