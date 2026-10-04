import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { runCleanup } from '../cleanup'
import {
  ACCOUNTS,
  DEV_PASSWORD,
  FIXTURE_MARKER,
  FIXTURE_USER_DOMAIN,
  VIEWPORTS,
  createTicket,
  createUser,
  firstRequester,
  fixtureEmail,
  loginAs,
  sessionAs,
  shot,
  signInThroughForm,
  signOut,
} from './helpers'

/**
 * Screenshots for the submission PDF (handout §14, Parts 5 to 8), at the paths
 * ui-spec.md §11 names.
 *
 * Every capture comes after an assertion that the state is on screen. A
 * screenshot taken before the state arrives looks like evidence and shows the
 * wrong moment.
 *
 * These are meant to be run with `npm run e2e:fresh`, on a database holding
 * the seed and nothing else. The cleanup at the top removes whatever earlier
 * specs in the same run created, so no capture shows another spec's fixture.
 */

test.describe.configure({ mode: 'serial' })

// Only on the fresh database. On a development one the captures would show
// whatever its owner has left in it, and would overwrite the committed
// evidence with that.
test.skip(
  !process.env.E2E_FRESH,
  'submission evidence is captured on a fresh database: run `npm run e2e:fresh`',
)

test.beforeAll(() => {
  runCleanup()
})

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop)
})

const capture = (page: Page, screen: string, name: string, fullPage = true) =>
  page.screenshot({ path: shot(screen, name), fullPage })

test.describe('Part 5: authentication', () => {
  test('login, an invalid attempt, and the busy state', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await capture(page, 'authentication', 'login')

    await signInThroughForm(page, ACCOUNTS.staff.email, 'not-the-password')
    await expect(page.getByRole('alert')).toBeVisible()
    await capture(page, 'authentication', 'login-invalid')

    // Hold the request open so the busy button can be photographed.
    await page.route('**/api/auth/login', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      await route.continue()
    })
    await page.getByLabel(/^Password/).fill(DEV_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('Signing in…')).toBeVisible()
    await capture(page, 'authentication', 'login-busy')
    await expect(page).toHaveURL(/\/staff\/tickets$/)
  })

  test('the mandatory password change, and a rejected attempt', async ({ page, request }) => {
    const user = await createUser(request, { name: 'Riley Onboarding', role: 'REQUESTER', label: 'evidence-first-login' })

    await signInThroughForm(page, user.email, user.password)
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    await capture(page, 'authentication', 'change-password')

    await page.getByLabel(/^Current password/).fill(user.password)
    await page.getByLabel(/^New password/).fill('short')
    await page.getByLabel(/^Confirm new password/).fill('different')
    await page.getByRole('button', { name: 'Save and continue' }).click()
    await expect(page.getByText('Must be at least 8 characters')).toBeVisible()
    await capture(page, 'authentication', 'change-password-invalid')
  })

  for (const role of ['requester', 'staff', 'admin'] as const) {
    test(`the shell as ${role}: their name, role and navigation`, async ({ page }) => {
      await loginAs(page, role)
      await page.goto(ACCOUNTS[role].home)
      await expect(page.getByRole('banner').getByText(ACCOUNTS[role].name)).toBeVisible()
      await expect(page.locator('table, .ttk-empty-state').first()).toBeVisible()
      await capture(page, 'authentication', `shell-by-role-${role}`, false)
    })
  }

  test('logged out: a protected address returns to Login', async ({ page }) => {
    await loginAs(page, 'staff')
    await page.goto('/staff/tickets')
    await signOut(page)

    await page.goto('/staff/tickets')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await capture(page, 'authentication', 'logged-out')
  })
})

test.describe('Part 6: the IT Staff Ticket Queue', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'staff')
  })

  for (const viewport of ['desktop', 'tablet', 'mobile'] as const) {
    test(`the queue at ${viewport} width`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[viewport])
      await page.goto('/staff/tickets')
      const rows = viewport === 'mobile' ? page.locator('.ttk-queue__card') : page.getByRole('table').getByRole('row')
      await expect(rows.first()).toBeVisible()
      // The queue as seeded: every Ticket in it carries a seed number.
      const numbers = await page.locator('.ttk-queue__number').allTextContents()
      expect(numbers.filter((number) => !/^TKT-\d{4}-8\d{5}$/.test(number))).toEqual([])
      await capture(page, 'staff-queue', viewport)
    })
  }

  test('filters applied, the unassigned view, and no results', async ({ page }) => {
    await page.goto('/staff/tickets')
    await page.getByLabel('Status').selectOption('IN_PROGRESS')
    await page.getByLabel('Sort by').selectOption('itPriority')
    await expect(page).toHaveURL(/status=IN_PROGRESS/)
    await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('In Progress')
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible()
    await capture(page, 'staff-queue', 'filters-applied')

    await page.goto('/staff/tickets?owner=unassigned')
    await expect(page.getByLabel('Owner')).toHaveValue('unassigned')
    await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('Unassigned')
    await capture(page, 'staff-queue', 'unassigned')

    await page.getByLabel('Search').fill('no ticket says this')
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByText('No Tickets match these filters.')).toBeVisible()
    await capture(page, 'staff-queue', 'no-results')
  })

  test('the empty queue', async ({ page }) => {
    // The seed always has Tickets, so the one state that cannot be reached
    // with real data is shown by answering the queue request with none. The
    // screen is the real one; only this response is supplied.
    await page.route('**/api/staff/tickets?*', (route) =>
      route.fulfill({
        json: { data: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 }, filtered: false },
      }),
    )
    await page.goto('/staff/tickets')
    await expect(page.getByText('No Tickets in the queue yet.')).toBeVisible()
    await capture(page, 'staff-queue', 'empty')
  })
})

test.describe('Part 7: the IT Staff Ticket Detail', () => {
  let ticket: { id: number; ticketNumber: string }

  test.beforeAll(async ({ request }) => {
    const requester = await firstRequester(request)
    ticket = await createTicket(request, requester, {
      summary: 'Projector in LX-204 shows no signal from the lectern',
      description: `The lectern PC is on and the cable is seated, but the projector reports no signal. Two lectures were affected this morning. Reported during the ${FIXTURE_MARKER}.`,
      requestedPriority: 'MEDIUM',
    })
  })

  test('ownership, IT Priority, a status move, and both streams', async ({ page }) => {
    await loginAs(page, 'staff')
    await page.goto(`/staff/tickets/${ticket.id}`)
    const workflow = page.getByRole('region', { name: 'Workflow' })

    await expect(page.getByTestId('owner-current')).toHaveText('Unassigned')
    await workflow.getByRole('button', { name: 'Claim' }).click()
    await expect(page.getByTestId('owner-current')).toHaveText('Sarah Chen (you)')
    await workflow.screenshot({ path: shot('staff-ticket-detail', 'ownership') })

    await workflow.getByLabel('IT Priority').selectOption('HIGH')
    await expect(workflow.getByText('Currently')).toContainText('High')
    await expect(page.getByTestId('requested-priority')).toHaveText('Medium')
    await workflow.screenshot({ path: shot('staff-ticket-detail', 'it-priority') })

    await workflow.getByLabel('Move to').selectOption('IN_PROGRESS')
    await workflow.getByRole('button', { name: 'Change status' }).click()
    await expect(workflow.locator('.ttk-badge', { hasText: 'In Progress' })).toBeVisible()
    // The next move chosen but not yet made, so the capture shows both the
    // status it has and the one it is about to be given.
    await workflow.getByLabel('Move to').selectOption('WAITING_FOR_REQUESTER')
    await workflow.screenshot({ path: shot('staff-ticket-detail', 'status-transition') })
    await workflow.getByLabel('Move to').selectOption('')

    await page.getByLabel('Add a public comment').fill('Could you tell us which input the projector is set to? It is shown on its front panel.')
    await page.getByRole('button', { name: 'Post comment' }).click()
    const publicStream = page.locator('.ttk-thread').filter({ hasText: 'Public Comments' })
    await expect(publicStream.getByText(/which input the projector/)).toBeVisible()
    await publicStream.screenshot({ path: shot('staff-ticket-detail', 'comments') })

    await page.getByLabel('Add an internal note').fill('Third report from LX-204 this term. The HDMI switch behind the lectern is the likely fault; spare is in store room B.')
    await page.getByRole('button', { name: 'Add internal note' }).click()
    const internalStream = page.locator('.ttk-thread--internal')
    await expect(internalStream.getByText(/HDMI switch behind the lectern/)).toBeVisible()
    await internalStream.screenshot({ path: shot('staff-ticket-detail', 'internal-notes') })

    await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
    await capture(page, 'staff-ticket-detail', 'desktop')

    await page.setViewportSize(VIEWPORTS.mobile)
    await expect(workflow).toBeVisible()
    await capture(page, 'staff-ticket-detail', 'mobile')
  })

  test('direct API calls are refused by role, whatever the screen offers', async ({ page, playwright }) => {
    // One isolated context per identity, so each row is certain about who
    // was asking. See sessionAs().
    const nobody = await sessionAs(playwright)
    const requester = await sessionAs(playwright, ACCOUNTS.requester.email)
    const staff = await sessionAs(playwright, ACCOUNTS.staff.email)
    const other = await sessionAs(playwright, 'ned.leeds@toktickit.test')

    // Each context really is who it claims to be, and the first is nobody.
    expect((await nobody.get('/api/auth/me')).status()).toBe(401)
    expect((await (await requester.get('/api/auth/me')).json()).user.email).toBe(ACCOUNTS.requester.email)
    expect((await (await staff.get('/api/auth/me')).json()).user.role).toBe('IT_STAFF')
    expect((await (await other.get('/api/auth/me')).json()).user.email).toBe('ned.leeds@toktickit.test')

    const attempts: { who: string; call: string; expect: number; cookie: typeof nobody; method: string; path: string; body?: unknown }[] = [
      { who: 'Nobody (no session)', call: 'read the Ticket Queue', expect: 401, cookie: nobody, method: 'GET', path: '/api/staff/tickets' },
      { who: 'Requester', call: 'read the Ticket Queue', expect: 403, cookie: requester, method: 'GET', path: '/api/staff/tickets' },
      { who: 'Requester', call: 'open the staff view of their own Ticket', expect: 403, cookie: requester, method: 'GET', path: `/api/staff/tickets/${ticket.id}` },
      { who: 'Requester', call: 'set their own Ticket to Resolved', expect: 403, cookie: requester, method: 'PATCH', path: `/api/staff/tickets/${ticket.id}/status`, body: { currentStatus: 'RESOLVED' } },
      { who: 'Requester', call: 'make themselves the Ticket Owner', expect: 403, cookie: requester, method: 'PATCH', path: `/api/staff/tickets/${ticket.id}/owner`, body: { ownerId: 1 } },
      { who: 'Requester', call: 'ask for the Internal Notes on their own Ticket', expect: 403, cookie: requester, method: 'GET', path: `/api/tickets/${ticket.id}/comments?visibility=INTERNAL` },
      { who: 'Requester', call: 'post an Internal Note', expect: 403, cookie: requester, method: 'POST', path: `/api/tickets/${ticket.id}/comments`, body: { body: 'Trying to write a note.', visibility: 'INTERNAL' } },
      { who: 'Another Requester', call: "open somebody else's Ticket", expect: 404, cookie: other, method: 'GET', path: `/api/tickets/${ticket.id}` },
      { who: 'Another Requester', call: "read somebody else's comments", expect: 404, cookie: other, method: 'GET', path: `/api/tickets/${ticket.id}/comments` },
      { who: 'Requester', call: 'list users', expect: 403, cookie: requester, method: 'GET', path: '/api/users' },
      { who: 'IT Staff', call: 'list users', expect: 403, cookie: staff, method: 'GET', path: '/api/users' },
      { who: 'IT Staff', call: 'create a user', expect: 403, cookie: staff, method: 'POST', path: '/api/users', body: { name: 'Should Not Exist', email: fixtureEmail('refused'), role: 'ADMINISTRATOR', initialPassword: 'Initial123!' } },
      { who: 'IT Staff', call: "file a Ticket on a Requester's behalf", expect: 403, cookie: staff, method: 'POST', path: '/api/tickets', body: {} },
    ]

    const results: { who: string; call: string; request: string; status: number; body: string }[] = []
    for (const attempt of attempts) {
      const response = await attempt.cookie.fetch(attempt.path, {
        method: attempt.method,
        data: attempt.body,
      })
      const body = await response.text()

      expect([attempt.who, attempt.call, response.status()]).toEqual([attempt.who, attempt.call, attempt.expect])
      // A refusal carries a reason and nothing about the thing refused.
      expect(body).not.toContain(ticket.ticketNumber)
      expect(body).not.toContain('HDMI switch')
      results.push({ who: attempt.who, call: attempt.call, request: `${attempt.method} ${attempt.path}`, status: response.status(), body })
    }

    // The refused writes wrote nothing.
    const after = await (await staff.get(`/api/staff/tickets/${ticket.id}`)).json()
    expect(after.currentStatus).toBe('IN_PROGRESS')
    expect(after.owner.name).toBe('Sarah Chen')

    mkdirSync('artifacts/lab-03', { recursive: true })
    writeFileSync('artifacts/lab-03/api-authorization.json', `${JSON.stringify(results, null, 2)}\n`)

    // The same results as a page, so they can go in the PDF as an image.
    const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.setContent(`<!doctype html><html><head><style>
      body { font: 15px/1.45 -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1f2e27; margin: 24px; }
      h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 0 0 16px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #cbd5ce; vertical-align: top; }
      th { background: #eaf6ef; } code { font: 13px ui-monospace, Menlo, monospace; }
      .status { font-weight: 700; white-space: nowrap; }
    </style></head><body>
      <h1>Direct API calls, made with a real session for each role</h1>
      <p>Each row is one request sent straight to the API, with no screen involved, and the response it received.</p>
      <table><thead><tr><th>Who</th><th>Tried to</th><th>Request</th><th>Status</th><th>Response body</th></tr></thead><tbody>
      ${results.map((row) => `<tr><td>${escape(row.who)}</td><td>${escape(row.call)}</td><td><code>${escape(row.request)}</code></td><td class="status">${row.status}</td><td><code>${escape(row.body)}</code></td></tr>`).join('')}
      </tbody></table></body></html>`)
    await expect(page.getByRole('row')).toHaveCount(results.length + 1)
    await capture(page, 'staff-ticket-detail', 'forbidden-api')
  })
})

test.describe('Part 8: Administrator User Management', () => {
  // Again here, because Part 5 above created a user for the password-change
  // capture, and without this they would be sitting in the list below.
  test.beforeAll(() => {
    runCleanup()
  })

  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/users')
    await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible()
  })

  test('the list, a search, and the role filter', async ({ page }) => {
    await expect(page.getByRole('table').getByRole('row').nth(1)).toBeVisible()
    // The list as seeded: nobody the suite made is in it.
    await expect(page.getByRole('table').getByText(FIXTURE_USER_DOMAIN)).toHaveCount(0)
    await capture(page, 'user-management', 'list')

    await page.getByLabel('Search').fill('chen')
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(2)
    await capture(page, 'user-management', 'search')

    await page.getByRole('button', { name: 'Clear filters' }).click()
    await page.getByLabel('Role').selectOption('IT_STAFF')
    await expect(page.getByRole('table').getByText('Requester')).toHaveCount(0)
    await expect(page.getByRole('table').getByText('IT Staff').first()).toBeVisible()
    await capture(page, 'user-management', 'role-filter')

    await page.setViewportSize(VIEWPORTS.mobile)
    await expect(page.locator('.ttk-users__card').first()).toBeVisible()
    await capture(page, 'user-management', 'mobile')
  })

  test('creating a user, and a duplicate address refused', async ({ page }) => {
    const email = fixtureEmail('evidence-created')
    const dialog = page.getByRole('dialog')

    await page.getByRole('button', { name: 'New user' }).click()
    await dialog.getByLabel(/^Name/).fill('Morgan Fairweather')
    await dialog.getByLabel(/^Email/).fill(email)
    await dialog.getByRole('radio', { name: 'IT Staff' }).check()
    await dialog.getByLabel(/^Initial password/).fill('Initial123!')
    await expect(dialog.getByRole('radio', { name: 'IT Staff' })).toBeChecked()
    await capture(page, 'user-management', 'create', false)
    await dialog.getByRole('button', { name: 'Create user' }).click()
    await expect(page.locator('.ttk-users__message')).toContainText('Morgan Fairweather was created')

    await page.getByRole('button', { name: 'New user' }).click()
    await dialog.getByLabel(/^Name/).fill('Morgan Again')
    await dialog.getByLabel(/^Email/).fill(email)
    await dialog.getByRole('radio', { name: 'Requester' }).check()
    await dialog.getByLabel(/^Initial password/).fill('Initial123!')
    await dialog.getByRole('button', { name: 'Create user' }).click()
    await expect(dialog.getByText('That email address is already in use')).toBeVisible()
    await capture(page, 'user-management', 'duplicate-email', false)
    await page.keyboard.press('Escape')

    // Editing them, and setting a new initial password.
    await page.getByRole('table').getByRole('button', { name: 'Edit Morgan Fairweather' }).click()
    await expect(dialog.getByLabel(/^Name/)).toHaveValue('Morgan Fairweather')
    await capture(page, 'user-management', 'edit', false)

    await dialog.getByRole('button', { name: 'Set new initial password' }).click()
    await dialog.getByLabel('New initial password for Morgan Fairweather').fill('Second456!')
    await expect(dialog.getByText(/signs them out everywhere/)).toBeVisible()
    await capture(page, 'user-management', 'initial-password', false)
    await dialog.getByRole('button', { name: 'Confirm new password' }).click()
    await expect(page.locator('.ttk-users__message')).toContainText('A new initial password was set')
  })

  test('the guard-rails on the last Administrator', async ({ page }) => {
    await page.getByRole('table').getByRole('button', { name: `Edit ${ACCOUNTS.admin.name}` }).click()
    const dialog = page.getByRole('dialog')

    await expect(dialog.getByRole('checkbox', { name: 'Active' })).toBeDisabled()
    await expect(dialog.getByText('You cannot deactivate your own account.')).toBeVisible()
    await expect(dialog.getByText(/last active Administrator/)).toBeVisible()
    await capture(page, 'user-management', 'guard-rails', false)
  })
})
