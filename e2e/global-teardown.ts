import { execFileSync } from 'node:child_process'

/**
 * Runs the server package's cleanup script after the suite.
 *
 * Shelling out rather than importing Prisma here keeps the e2e project free of
 * the server's generated client and its module resolution — the script already
 * has both.
 */
export default function globalTeardown() {
  try {
    const output = execFileSync('npx', ['tsx', 'src/scripts/e2e-cleanup.ts'], {
      cwd: 'server',
      encoding: 'utf-8',
    })
    process.stdout.write(output)
  } catch (error) {
    // Cleanup failing must not turn a green run red.
    process.stdout.write(`e2e cleanup skipped: ${(error as Error).message}\n`)
  }
}
