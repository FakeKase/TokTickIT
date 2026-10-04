import { defineConfig } from '@playwright/test'

/**
 * Visual and end-to-end suite (tests.md RESP-01/RESP-02, E2E-01/E2E-02).
 *
 * Runs against the real stack rather than a mock: Playwright starts both the
 * API and the Vite dev server, so what these specs capture is what a marker
 * would see opening the app themselves.
 */
// Where the suite's own API and client listen. The defaults are the ordinary
// development ports; `npm run e2e:fresh` sets both to ports of its own, so a
// run on the fresh database starts its own servers and cannot end up talking
// to a development server that happens to be up.
const apiPort = Number(process.env.E2E_API_PORT ?? 3001)
const clientPort = Number(process.env.E2E_CLIENT_PORT ?? 5173)
const apiUrl = `http://localhost:${apiPort}`
const clientUrl = `http://localhost:${clientPort}`

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  // These share one database and one seeded Requester, so they must not
  // interleave — the same reason the server's vitest suite is serialized.
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: 'artifacts/lab-02/playwright-report', open: 'never' }]],
  use: {
    baseURL: clientUrl,
    // Screenshots are the deliverable here, so a failing run keeps its trace
    // rather than leaving only a red line in the log.
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm start',
      cwd: './server',
      // The API only answers a browser whose origin it was told about.
      env: { PORT: String(apiPort), CLIENT_ORIGIN: clientUrl },
      url: `${apiUrl}/api/health`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `npm run dev -- --port ${clientPort} --strictPort`,
      cwd: './client',
      env: { VITE_API_URL: apiUrl },
      url: clientUrl,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
