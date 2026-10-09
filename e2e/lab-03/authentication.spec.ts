import { expect, test } from '@playwright/test'
import {
  ACCOUNTS,
  API,
  DEV_PASSWORD,
  createUser,
  loginAs,
  signInThroughForm,
  signOut,
} from './helpers'

// E2E-01, E2E-02 (AC-01, AC-02, AC-05, AC-06, AC-08, AC-13).

test.describe('E2E-01 signing in and out', () => {
  test('a wrong password, then the right one, then logout closes the door behind it', async ({
    page,
  }) => {
    // A protected URL with no session goes to Login (AC-13).
    await page.goto('/staff/tickets')
    await expect(page).toHaveURL(/\/login$/)

    // AC-06: one message, whichever half was wrong.
    await signInThroughForm(page, ACCOUNTS.staff.email, 'not-the-password')
    const wrongPassword = await page.getByRole('alert').textContent()
    await expect(page).toHaveURL(/\/login$/)

    await signInThroughForm(page, 'nobody.at.all@toktickit.test', DEV_PASSWORD)
    await expect(page.getByRole('alert')).toHaveText(wrongPassword ?? '')

    // AC-01. Back to the queue, not the Dashboard: that is the address the
    // guard interrupted at the top of this test.
    await signInThroughForm(page, ACCOUNTS.staff.email, DEV_PASSWORD)
    await expect(page).toHaveURL(/\/staff\/tickets$/)
    await expect(page.getByRole('heading', { name: 'Ticket Queue' })).toBeVisible()
    await expect(page.getByRole('banner').getByText('IT Staff')).toBeVisible()

    // AC-08: the session is gone on the server, not just forgotten here.
    const cookies = await page.context().cookies()
    await signOut(page)
    await page.goto('/staff/tickets')
    await expect(page).toHaveURL(/\/login$/)

    await page.context().addCookies(cookies)
    const replayed = await page.request.get(`${API}/api/auth/me`)
    expect(replayed.status()).toBe(401)
  })

  test('an inactive account is refused with the same message as a wrong password (AC-05)', async ({
    page,
  }) => {
    await signInThroughForm(page, ACCOUNTS.staff.email, 'not-the-password')
    const generic = await page.getByRole('alert').textContent()

    await signInThroughForm(page, 'viktor.hale@toktickit.test', DEV_PASSWORD)

    await expect(page.getByRole('alert')).toHaveText(generic ?? '')
    await expect(page).toHaveURL(/\/login$/)
  })

  for (const role of ['requester', 'staff', 'admin'] as const) {
    test(`${role} lands on their own screen and sees only their own navigation`, async ({ page }) => {
      await signInThroughForm(page, ACCOUNTS[role].email, DEV_PASSWORD)
      await expect(page).toHaveURL(new RegExp(`${ACCOUNTS[role].landing}$`))

      const nav = page.getByRole('banner').getByRole('link')
      const labels = (await nav.allTextContents()).filter((label) => label !== 'TokTickIT')
      expect(labels).toEqual(
        {
          requester: ['Dashboard', 'My Tickets', 'Create Ticket'],
          staff: ['Dashboard', 'Ticket Queue'],
          admin: ['Dashboard', 'Ticket Queue', 'User Management', 'System Status'],
        }[role],
      )
    })
  }

  test('each role is shown Forbidden, not the screen, on a route that is not theirs', async ({
    page,
  }) => {
    await loginAs(page, 'requester')
    for (const path of ['/staff/tickets', '/admin/users']) {
      await page.goto(path)
      await expect(page.getByRole('alert')).toContainText('do not have permission')
    }

    await page.context().clearCookies()
    await loginAs(page, 'staff')
    for (const path of ['/tickets', '/admin/users']) {
      await page.goto(path)
      await expect(page.getByRole('alert')).toContainText('do not have permission')
    }
  })
})

test.describe('E2E-02 the first-login password change (AC-02)', () => {
  test('the app opens only after a valid change, and the initial password stops working', async ({
    page,
    request,
  }) => {
    const user = await createUser(request, { name: 'Erin First-Login', role: 'IT_STAFF', label: 'first-login' })
    const chosen = 'Chosen-By-Erin-7'

    await signInThroughForm(page, user.email, user.password)
    await expect(page).toHaveURL(/\/change-password$/)
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()

    // Signed in, but nothing else opens until the password is their own.
    await page.goto('/staff/tickets')
    await expect(page).toHaveURL(/\/change-password$/)
    const gated = await page.request.get(`${API}/api/staff/tickets`)
    expect(gated.status()).toBe(403)
    expect((await gated.json()).code).toBe('PASSWORD_CHANGE_REQUIRED')

    // A mismatch is caught and changes nothing.
    await page.getByLabel(/^Current password/).fill(user.password)
    await page.getByLabel(/^New password/).fill(chosen)
    await page.getByLabel(/^Confirm new password/).fill(`${chosen}-typo`)
    await page.getByRole('button', { name: 'Save and continue' }).click()
    await expect(page.getByText('This does not match the new password')).toBeVisible()
    await expect(page).toHaveURL(/\/change-password$/)

    await page.getByLabel(/^Confirm new password/).fill(chosen)
    await page.getByRole('button', { name: 'Save and continue' }).click()

    // Straight to the screen for their role.
    await expect(page).toHaveURL(/\/staff\/dashboard$/)
    await expect(page.getByRole('heading', { name: /^Welcome back/ })).toBeVisible()

    await signOut(page)
    await signInThroughForm(page, user.email, user.password)
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)

    await signInThroughForm(page, user.email, chosen)
    await expect(page).toHaveURL(/\/staff\/dashboard$/)
  })
})
