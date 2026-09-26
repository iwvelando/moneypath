import { defineConfig, devices } from '@playwright/test';

// Browser tests run against `vite preview` of the production build in dist/
// (build it with `make dist` so the real engine is in it), under the production
// Content-Security-Policy. BASE_URL points them at a deployed site instead.
const remote = process.env.BASE_URL;
// WEBKIT=1 adds Safari's engine, which every iOS browser also uses, for
// e2e/webkit.spec.ts (`make test-webkit`). It is opt-in so ordinary runs need
// only Chromium installed.
const webkit = /webkit\.spec\.ts$/;
const layout = /layout\.spec\.ts$/;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  use: {
    baseURL: remote ?? 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 1000 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' }, testIgnore: webkit },
    // A narrow Android phone: 360 px exposes overflow that 390–412 px hides.
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], viewport: { width: 360, height: 760 } },
      testMatch: layout,
    },
    ...(process.env.WEBKIT
      ? [{ name: 'webkit', use: { ...devices['iPhone 15'] }, testMatch: webkit }]
      : []),
  ],
  webServer: remote
    ? undefined
    : {
        command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
      },
});
