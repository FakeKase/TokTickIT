import { defineConfig } from '@playwright/test'

/**
 * Visual and end-to-end suite (tests.md RESP-01/RESP-02, E2E-01/E2E-02).
 *
 * Runs against the real stack rather than a mock: Playwright starts both the
 * API and the Vite dev server, so what these specs capture is what a marker
 * would see opening the app themselves.
 */
export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/global-teardown.ts',
  // These share one database and one seeded Requester, so they must not
  // interleave — the same reason the server's vitest suite is serialized.
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: 'artifacts/lab-02/playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    // Screenshots are the deliverable here, so a failing run keeps its trace
    // rather than leaving only a red line in the log.
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm start',
      cwd: './server',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      cwd: './client',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
