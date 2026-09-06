import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { FIXTURE_MARKER } from './helpers'

/**
 * The teardown can only remove what it can find. The marker is written by this
 * suite and matched by a script in another package, so nothing but this check
 * ties the two together — and a Ticket that slips the filter leaks into the
 * demo database on every run.
 */
const SPEC_DIR = 'e2e/lab-02'

test.describe('fixture cleanup contract', () => {
  test('the cleanup script filters on the marker this suite writes', () => {
    const script = readFileSync('server/src/scripts/e2e-cleanup.ts', 'utf-8')
    const declared = script.match(/const MARKER = "([^"]+)"/)

    expect(declared, 'e2e-cleanup.ts no longer declares a MARKER').not.toBeNull()
    expect(declared![1]).toBe(FIXTURE_MARKER)
  })

  test('every Ticket-creating path in every spec carries the marker', () => {
    // A form submission is a real row too. Catching a fill() that invents its
    // own description is the specific regression this guards — and it scans
    // every spec, not just the one it was written for, since a new file is
    // exactly where the next one would slip in.
    const specs = readdirSync(SPEC_DIR).filter((f) => f.endsWith('.spec.ts'))
    expect(specs.length).toBeGreaterThan(1)

    let fillsFound = 0
    for (const file of specs) {
      const source = readFileSync(join(SPEC_DIR, file), 'utf-8')
      for (const [, argument] of source.matchAll(
        /getByLabel\(\/\^Description\/\)\s*\.fill\(([^)]*)\)/g,
      )) {
        fillsFound += 1
        // The value may be inline or a const declared in the same file, so
        // resolve one level of indirection rather than demanding the marker
        // appear literally at the call site.
        const inline = argument.includes('FIXTURE_MARKER')
        const identifier = argument.trim().match(/^[A-Za-z_$][\w$]*$/)?.[0]
        const viaConst =
          identifier !== undefined &&
          new RegExp(`const ${identifier}\\s*=[^\n]*FIXTURE_MARKER`).test(source)

        expect(
          inline || viaConst,
          `${file}: description "${argument.trim()}" does not carry FIXTURE_MARKER, so the Ticket would escape the teardown`,
        ).toBe(true)
      }
    }

    expect(fillsFound, 'no Description fills found — did the query change?').toBeGreaterThan(0)
  })
})
