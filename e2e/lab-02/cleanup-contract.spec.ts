import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { FIXTURE_MARKER } from './helpers'

/**
 * The teardown can only remove what it can find. The marker is written by this
 * suite and matched by a script in another package, so nothing but this check
 * ties the two together — and a Ticket that slips the filter leaks into the
 * demo database on every run.
 */
test.describe('fixture cleanup contract', () => {
  test('the cleanup script filters on the marker this suite writes', () => {
    const script = readFileSync('server/src/scripts/e2e-cleanup.ts', 'utf-8')
    const declared = script.match(/const MARKER = "([^"]+)"/)

    expect(declared, 'e2e-cleanup.ts no longer declares a MARKER').not.toBeNull()
    expect(declared![1]).toBe(FIXTURE_MARKER)
  })

  test('every Ticket-creating path in the suite carries the marker', () => {
    // A form submission is a real row too. Catching a fill() that invents its
    // own description is the specific regression this guards.
    const spec = readFileSync('e2e/lab-02/visual-regression.spec.ts', 'utf-8')
    const descriptionFills = [
      ...spec.matchAll(/getByLabel\(\/\^Description\/\)\s*\.fill\(([^)]*)\)/g),
    ]

    expect(descriptionFills.length, 'no Description fills found — did the query change?')
      .toBeGreaterThan(0)
    for (const [, argument] of descriptionFills) {
      expect(argument, 'a submitted Ticket would escape the teardown').toContain(
        'FIXTURE_MARKER',
      )
    }
  })
})
