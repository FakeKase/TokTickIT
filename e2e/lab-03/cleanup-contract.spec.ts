import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { FIXTURE_USER_DOMAIN } from './helpers'

/**
 * The teardown can only remove what it can find. Users the suite creates are
 * found by their email domain, which is written here and matched by a script
 * in another package; nothing but this check ties the two together.
 */
const SPEC_DIR = 'e2e/lab-03'

test.describe('fixture user cleanup contract', () => {
  test('the cleanup script filters on the domain this suite uses', () => {
    const script = readFileSync('server/src/scripts/e2e-cleanup.ts', 'utf-8')
    const declared = script.match(/const USER_DOMAIN = "([^"]+)"/)

    expect(declared, 'e2e-cleanup.ts no longer declares a USER_DOMAIN').not.toBeNull()
    expect(declared![1]).toBe(FIXTURE_USER_DOMAIN)
  })

  test('no spec types an email address of its own into the New user form', () => {
    // A user created through the form is a real row. One whose address was
    // typed as a literal, rather than built by fixtureEmail(), would escape
    // the teardown and sit in the next run's User Management screenshots.
    const specs = readdirSync(SPEC_DIR).filter((file) => file.endsWith('.spec.ts'))
    expect(specs.length).toBeGreaterThan(1)

    for (const file of specs) {
      const source = readFileSync(join(SPEC_DIR, file), 'utf-8')
      for (const [, argument] of source.matchAll(/getByLabel\(\/\^Email\/\)\s*\.fill\(([^)]*)\)/g)) {
        expect(
          /^['"`]/.test(argument.trim()),
          `${file}: Email is filled with the literal ${argument.trim()}, which the teardown cannot find`,
        ).toBe(false)
      }
    }
  })
})
