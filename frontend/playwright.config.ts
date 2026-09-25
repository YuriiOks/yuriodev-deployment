import { defineConfig, devices } from '@playwright/test';

/*
 * Browser checks against the production build (vite preview), in Chromium at
 * the site's reference sizes. CI runs them in the e2e job; every /api request
 * is answered from e2e/fixtures.ts, so nothing leaves the runner.
 */

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CI = !!process.env.CI;

/*
 * Phones and the portrait tablet get a touch screen, as the real devices do:
 * the site has `(pointer: coarse)` and `(hover: none)` rules (bigger footer
 * targets, among others) that a desktop profile never triggers. 1024x768 and
 * up stay desktop windows with a mouse.
 */
const PHONE = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } as const;
const TABLET = { hasTouch: true } as const;

const sizes: ReadonlyArray<readonly [number, number, object?]> = [
  [375, 812, PHONE],
  [768, 1024, TABLET],
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
  [812, 375, PHONE],
];

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    // Instant scrolling and no loading screen: the same page every run.
    reducedMotion: 'reduce',
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 180_000,
  },
  projects: sizes.map(([width, height, device = {}]) => ({
    name: `${width}x${height}`,
    use: { ...devices['Desktop Chrome'], ...device, viewport: { width, height } },
  })),
});
