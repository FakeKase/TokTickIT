import { expect, test } from '@playwright/test'
import {
  ACCOUNTS,
  API,
  cookieFor,
  fixtureEmail,
  loginAs,
  sessionAs,
  signInThroughForm,
} from './helpers'

// E2E-05, E2E-06 (AC-35 to AC-41).

test.describe('E2E-05 an account, from created to switched off', () => {
  test('created by the Administrator, forced to choose a password, reset, then deactivated', async ({
    page,
    browser,
  }) => {
    const name = 'Jamie Newstart'
    const email = fixtureEmail('newstart')
    const first = 'Initial123!'
    const second = 'Second456!'

    await loginAs(page, 'admin')
    await page.goto('/admin/users')
    await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible()

    // AC-37.
    await page.getByRole('button', { name: 'New user' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Name/).fill(name)
    await dialog.getByLabel(/^Email/).fill(email)
    await dialog.getByRole('radio', { name: 'Requester' }).check()
    await dialog.getByLabel(/^Initial password/).fill(first)
    await dialog.getByRole('button', { name: 'Create user' }).click()
    await expect(page.locator('.ttk-users__message')).toContainText(`${name} was created`)

    // AC-36: found by part of the address, then by role.
    await page.getByLabel('Search').fill(email.slice(0, 14).toUpperCase())
    await page.getByRole('button', { name: 'Search' }).click()
    const row = page.getByRole('table').getByRole('row').filter({ hasText: email })
    await expect(row).toContainText('Requester')
    await expect(row).toContainText('Active')
    await page.getByLabel('Role').selectOption('IT_STAFF')
    await expect(page.getByText('No users match this search.')).toBeVisible()
    await page.getByLabel('Role').selectOption('REQUESTER')
    await expect(row).toBeVisible()

    // AC-38: the same address again is refused on the Email field.
    await page.getByRole('button', { name: 'New user' }).click()
    await dialog.getByLabel(/^Name/).fill('Somebody Else')
    await dialog.getByLabel(/^Email/).fill(email)
    await dialog.getByRole('radio', { name: 'IT Staff' }).check()
    await dialog.getByLabel(/^Initial password/).fill(first)
    await dialog.getByRole('button', { name: 'Create user' }).click()
    await expect(dialog.getByLabel(/^Email/)).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog.getByText('That email address is already in use')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // The new person, in a browser of their own.
    const theirContext = await browser.newContext()
    const theirs = await theirContext.newPage()
    await signInThroughForm(theirs, email, first)
    await expect(theirs).toHaveURL(/\/change-password$/)

    // AC-41: a new initial password ends that session and replaces the old one.
    await page.getByRole('table').getByRole('button', { name: `Edit ${name}` }).click()
    await dialog.getByRole('button', { name: 'Set new initial password' }).click()
    await dialog.getByLabel(`New initial password for ${name}`).fill(second)
    await dialog.getByRole('button', { name: 'Confirm new password' }).click()
    await expect(page.locator('.ttk-users__message')).toContainText('A new initial password was set')

    await theirs.reload()
    await expect(theirs).toHaveURL(/\/login$/)
    await signInThroughForm(theirs, email, first)
    await expect(theirs.getByRole('alert')).toBeVisible()

    await signInThroughForm(theirs, email, second)
    await expect(theirs).toHaveURL(/\/change-password$/)
    await theirs.getByLabel(/^Current password/).fill(second)
    await theirs.getByLabel(/^New password/).fill('Chosen-By-Jamie-9')
    await theirs.getByLabel(/^Confirm new password/).fill('Chosen-By-Jamie-9')
    await theirs.getByRole('button', { name: 'Save and continue' }).click()
    // The screen for the role they were given.
    await expect(theirs).toHaveURL(/\/tickets$/)

    // Deactivated: their very next request is refused (AC-10).
    await page.getByRole('table').getByRole('button', { name: `Edit ${name}` }).click()
    await dialog.getByRole('checkbox', { name: 'Active' }).uncheck()
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.locator('.ttk-users__message')).toContainText(`${name} was updated`)
    await expect(row).toContainText('Inactive')

    await theirs.reload()
    await expect(theirs).toHaveURL(/\/login$/)
    await signInThroughForm(theirs, email, 'Chosen-By-Jamie-9')
    await expect(theirs.getByRole('alert')).toBeVisible()
    await expect(theirs).toHaveURL(/\/login$/)
    await theirContext.close()
  })
})

test.describe('E2E-06 the guard-rails (AC-39, AC-40)', () => {
  test('the dialog disables both, and says why', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/users')
    await page.getByRole('table').getByRole('button', { name: `Edit ${ACCOUNTS.admin.name}` }).click()
    const dialog = page.getByRole('dialog')

    await expect(dialog.getByRole('checkbox', { name: 'Active' })).toBeDisabled()
    await expect(dialog.getByText('You cannot deactivate your own account.')).toBeVisible()

    // The seed has one Administrator, so their role is locked too.
    for (const role of ['Requester', 'IT Staff', 'Administrator']) {
      await expect(dialog.getByRole('radio', { name: role })).toBeDisabled()
    }
    await expect(
      dialog.getByText('This is the last active Administrator. Promote another Administrator first.'),
    ).toBeVisible()
  })

  test('the API refuses both whatever the dialog allows', async ({ request }) => {
    const cookie = await cookieFor(request, ACCOUNTS.admin.email)
    const me = (await (await request.get(`${API}/api/auth/me`, { headers: { Cookie: cookie } })).json()).user

    const deactivate = await request.patch(`${API}/api/users/${me.id}`, {
      headers: { Cookie: cookie },
      data: { isActive: false },
    })
    expect(deactivate.status()).toBe(409)
    expect((await deactivate.json()).error).toBe('You cannot deactivate your own account')

    const demote = await request.patch(`${API}/api/users/${me.id}`, {
      headers: { Cookie: cookie },
      data: { role: 'IT_STAFF' },
    })
    expect(demote.status()).toBe(409)
    expect((await demote.json()).error).toBe('The system must keep at least one active Administrator')

    // Still an active Administrator, and still signed in.
    const after = await request.get(`${API}/api/auth/me`, { headers: { Cookie: cookie } })
    expect((await after.json()).user).toMatchObject({ role: 'ADMINISTRATOR', isActive: true })
  })

  test('nobody but an Administrator reaches the user endpoints (AC-14)', async ({ playwright }) => {
    const anonymous = await sessionAs(playwright)
    expect((await anonymous.get('/api/users')).status()).toBe(401)

    for (const role of ['requester', 'staff'] as const) {
      const session = await sessionAs(playwright, ACCOUNTS[role].email)
      const response = await session.get('/api/users')

      expect([role, response.status()]).toEqual([role, 403])
      expect(JSON.stringify(await response.json())).not.toContain('@toktickit.test')
    }
  })
})
