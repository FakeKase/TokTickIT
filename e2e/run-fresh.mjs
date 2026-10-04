// Runs the Playwright suite against a database built fresh for the run.
//
//   npm run e2e:fresh              the whole suite
//   npm run e2e:fresh -- e2e/lab-03  anything after -- goes to Playwright
//
// `npm run e2e` still runs against whatever database server/.env names. This
// is the one to use for the submission evidence, where the screenshots must
// show the seed and nothing a developer left behind.

import { execFileSync, spawnSync } from 'node:child_process'
import net from 'node:net'

/** Resolves true if something is already listening on the port. */
const inUse = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

// Ports of its own, so this run starts its own servers whatever else is up.
// A development server on the usual ports is left alone, and, more to the
// point, is not what the suite ends up talking to: Playwright reuses a server
// it finds listening, and that one would be on the development database.
const API_PORT = 3101
const CLIENT_PORT = 5273

for (const [port, what] of [
  [API_PORT, 'the API'],
  [CLIENT_PORT, 'the client'],
]) {
  if (await inUse(port)) {
    console.error(
      `Port ${port} is in use, so Playwright would reuse whatever is there as ${what} ` +
        'instead of starting one on the fresh database. Free it and run this again.',
    )
    process.exit(1)
  }
}

const databaseUrl = execFileSync('npx', ['tsx', 'src/scripts/e2e-fresh-db.ts'], {
  cwd: 'server',
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
  .trim()
  .split('\n')
  .pop()

console.log(`e2e: fresh database ready (${new URL(databaseUrl).pathname.slice(1)})`)

const result = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    // Tells the evidence spec it may run: see submission-evidence.spec.ts.
    E2E_FRESH: '1',
    E2E_API_PORT: String(API_PORT),
    E2E_CLIENT_PORT: String(CLIENT_PORT),
  },
})
process.exit(result.status ?? 1)
