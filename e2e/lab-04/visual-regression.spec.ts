import { expect, test } from '@playwright/test'
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import {
  ACCOUNTS,
  API,
  FIXTURE_MARKER,
  VIEWPORTS,
  actionsArea,
  cookieFor,
  createTicket,
  createUser,
  editAction,
  expectNoHorizontalScroll,
  firstRequester,
  loginAs,
  recordAction,
  settlePassword,
  shot,
  workflowChange,
} from './helpers'
import {
  THEMES,
  badgeLook,
  expectContained,
  expectMessageUnder,
  expectNothingClipped,
  setTheme,
  surfaceOf,
  tabThrough,
  typeOf,
} from './visual-helpers'

/**
 * ui-spec.md §10, one assertion per checklist line (RESP-01 to RESP-06).
 *
 * As in Labs 2 and 3, nothing here is decided by looking at a screenshot. The
 * captures are kept as evidence for submission Part 9, and are only written
 * on the fresh database, for the same reason as submission-evidence.spec.ts.
 */

const FRESH = Boolean(process.env.E2E_FRESH)
const capture = async (page: Page, screen: string, viewport: string, theme: string, fullPage = true) => {
  if (!FRESH) return
  await page.screenshot({
    path: shot('responsive', `${screen}-${viewport}${theme === 'dark' ? '-dark' : ''}`),
    fullPage,
  })
}

// Text with nowhere to break is what widens a layout that looked fine with
// tidy sentences, and people paste both of these into a work log all the time.
const UNBREAKABLE_FILE = 'projector_lx204_service_log_2026_10_final_FINAL_v3_corrected_resubmission.xlsx'
const UNBREAKABLE_URL =
  'https://vendor.example.com/support/cases/9120/attachments/download?file=lamp-hours-counter&session=abcdef0123456789abcdef'
const LONG_DESCRIPTION = [
  `Swapped the lamp module and reseated both ribbon cables. Followed the vendor procedure at ${UNBREAKABLE_URL} step by step.`,
  'The first lamp did not strike, so a second one from stock was fitted.',
  'Ran the built-in test pattern for fifteen minutes and checked the colour wheel, the fan and the thermal cut-out.',
  'Cleaned the intake filter, which was heavily clogged, and vacuumed the housing.',
].join('\n')

let ticket: { id: number; ticketNumber: string }
/** IT Staff who own nothing and have recorded nothing, for the zeros. */
let idle: { email: string; password: string; name: string }

const asIdle = async (page: Page) => {
  const response = await page.request.post(`${API}/api/auth/login`, {
    data: { email: idle.email, password: idle.password },
  })
  expect(response.ok(), 'could not sign in as the idle IT Staff user').toBe(true)
}

async function awkwardTicket(request: APIRequestContext) {
  const requester = await firstRequester(request)
  const created = (await createTicket(request, requester, {
    summary: `Projector fault, see ${UNBREAKABLE_FILE}`,
    description: `The projector in LX-204 shuts down after ten minutes. Reported during the ${FIXTURE_MARKER}.`,
    requestedPriority: 'HIGH',
  })) as { id: number; ticketNumber: string }

  const sarah = await cookieFor(request, ACCOUNTS.staff.email)
  const admin = await cookieFor(request, ACCOUNTS.admin.email)
  const me = (await (await request.get(`${API}/api/auth/me`, { headers: { Cookie: sarah } })).json()).user
  await workflowChange(request, created.id, 'owner', { ownerId: me.id }, sarah)
  await workflowChange(request, created.id, 'it-priority', { itPriority: 'URGENT' }, sarah)
  await workflowChange(request, created.id, 'status', { currentStatus: 'IN_PROGRESS' }, sarah)
  for (const [body, visibility] of [
    ['We have a replacement lamp in stock and will fit it today.', 'PUBLIC'],
    ['Second lamp failure in this room this term. Check the mains supply.', 'INTERNAL'],
  ]) {
    await request.post(`${API}/api/tickets/${created.id}/comments`, {
      headers: { Cookie: sarah },
      data: { body, visibility },
    })
  }

  // Three rows: a plain one, a long one that a colleague corrected, and the
  // newest, which asks for follow-up and so holds the Ticket back from
  // Resolved (BR-13). A minute apart, so each row's View control, which is
  // named by who and when, has a name of its own.
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
  await recordAction(request, created.id, admin, {
    actionAt: at(0),
    description: 'Checked the mains socket with a tester.',
    result: 'Socket is live.',
  })
  const long = await recordAction(request, created.id, sarah, {
    actionAt: at(1),
    description: LONG_DESCRIPTION,
    result: `Lamp strikes and holds. Full log saved as ${UNBREAKABLE_FILE}.`,
    attachmentNotes: UNBREAKABLE_FILE,
  })
  await editAction(request, created.id, long.id, admin, {
    result: `Lamp strikes and holds for fifteen minutes. Full log saved as ${UNBREAKABLE_FILE}.`,
  })
  await recordAction(request, created.id, sarah, {
    actionAt: at(2),
    description: 'Reset the lamp-hours counter.',
    result: 'Counter still reads 2,410 hours.',
    followUpRequired: true,
    followUpNote: `Needs the service remote. Vendor notes: ${UNBREAKABLE_URL}`,
  })
  return created
}

test.beforeAll(async ({ request }) => {
  ticket = await awkwardTicket(request)

  // One of Peter's Tickets waiting on him, so his dashboard has a row under
  // Needs your attention.
  const waiting = (await createTicket(request, await firstRequester(request), {
    summary: 'Which lecture room is the faulty projector in?',
    description: `Reported during the ${FIXTURE_MARKER}.`,
  })) as { id: number }
  const sarah = await cookieFor(request, ACCOUNTS.staff.email)
  await workflowChange(request, waiting.id, 'status', { currentStatus: 'OPEN' }, sarah)
  await workflowChange(request, waiting.id, 'status', { currentStatus: 'WAITING_FOR_REQUESTER' }, sarah)

  const created = await createUser(request, { name: 'Imani Idle', role: 'IT_STAFF', label: 'resp-idle' })
  await settlePassword(request, created, 'Settled123!')
  idle = { email: created.email, password: 'Settled123!', name: created.name }
})

const openStaffTicket = async (page: Page) => {
  await page.goto(`/staff/tickets/${ticket.id}`)
  await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
  await expect(actionsArea(page).getByText('3 Actions Taken', { exact: true })).toBeVisible()
}

/** The View control of the row or card that is on screen at this width. */
const viewButton = (page: Page, text: string) =>
  actionsArea(page)
    .locator('tr:visible, li:visible')
    .filter({ hasText: text })
    .getByRole('button', { name: /^View the Action Taken/ })

test.describe('RESP-01 (AC-48): no overflow, clipping or overlap, at three widths in both themes', () => {
  for (const theme of THEMES) {
    for (const [viewport, size] of Object.entries(VIEWPORTS)) {
      test(`every Lab 4 screen at ${viewport}, ${theme}`, async ({ page }) => {
        await setTheme(page, theme)
        await page.setViewportSize(size)
        const check = async (screen: string, fullPage = true) => {
          await expectNoHorizontalScroll(page, size.width)
          await expectNothingClipped(page)
          await capture(page, screen, viewport, theme, fullPage)
        }

        // IT Staff.
        await loginAs(page, 'staff')
        await page.goto('/staff/dashboard')
        await expect(page.getByTestId('by-status')).toBeVisible()
        await expect(page.getByTestId('list-my-actions').getByRole('link').first()).toBeVisible()
        await expectContained(page.getByTestId('list-recently-updated'), 'Recently updated Tickets')
        await expectContained(page.getByTestId('list-my-actions'), 'My recent Actions Taken')
        await check('staff-dashboard')

        await openStaffTicket(page)
        const area = actionsArea(page)
        await expectContained(area, 'Actions Taken, staff')
        // The table is allowed a scrollbar of its own, and must not need it.
        if (size.width >= 768) {
          const wrap = area.locator('.ttk-actions__table-wrap')
          expect(await wrap.evaluate((el) => el.scrollWidth - el.clientWidth), 'the table scrolls sideways').toBeLessThanOrEqual(0)
          // The two columns of typed text keep room to be read in. Free to
          // break anywhere, they would otherwise shrink to a syllable a line.
          for (const column of ['Action Description', 'Result']) {
            const box = await area.getByRole('columnheader', { name: column }).boundingBox()
            expect(box!.width, `${column} column at ${size.width}px`).toBeGreaterThanOrEqual(130)
          }
        }
        await check('actions-taken-staff')

        // The dialog, in each of its three modes.
        await area.getByRole('button', { name: 'Add Action Taken' }).click()
        const create = page.getByRole('dialog', { name: 'Add Action Taken' })
        await expect(create).toBeVisible()
        // The page behind is held still while the dialog is open.
        expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden')
        await create.getByLabel('Follow-Up Required?').check()
        await create.getByLabel(/^Action Description/).fill(LONG_DESCRIPTION)
        await expectContained(create, 'the dialog, create')
        await check('action-dialog', false)
        await page.keyboard.press('Escape')

        await viewButton(page, 'Full log saved as').click()
        const view = page.getByRole('dialog', { name: 'Action Taken', exact: true })
        await expect(view.getByText('Edited by', { exact: true })).toBeVisible()
        await expectContained(view, 'the dialog, view')
        await check('action-dialog-view', false)

        await view.getByRole('button', { name: 'Edit' }).click()
        const edit = page.getByRole('dialog', { name: 'Edit Action Taken' })
        await expect(edit.getByLabel(/^Attachment Notes/)).toHaveValue(UNBREAKABLE_FILE)
        await expectContained(edit, 'the dialog, edit')
        await check('action-dialog-edit', false)
        await page.keyboard.press('Escape')
        await page.context().clearCookies()

        // The Requester.
        await loginAs(page, 'requester')
        await page.goto('/dashboard')
        await expect(page.getByTestId('list-needs-attention').getByRole('link').first()).toBeVisible()
        await expectContained(page.getByTestId('list-recently-updated'), 'Recently updated')
        await check('requester-dashboard')

        await page.goto('/tickets?status=ACTIVE')
        await expect(page.getByLabel('Status', { exact: true })).toHaveValue('ACTIVE')
        await expect(page.locator('.ttk-my-tickets__table, .ttk-my-tickets__cards').first()).toBeAttached()
        await expectContained(page.getByRole('search'), 'the My Tickets filters')
        await check('my-tickets-status-filter')

        await page.goto(`/tickets/${ticket.id}`)
        await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
        await expect(actionsArea(page).getByText('3 Actions Taken', { exact: true })).toBeVisible()
        await expectContained(actionsArea(page), 'Actions Taken, Requester')
        await check('actions-taken-requester')
        await page.context().clearCookies()

        // The Administrator's extras.
        await loginAs(page, 'admin')
        await page.goto('/staff/dashboard')
        await expect(page.getByTestId('user-accounts')).toBeVisible()
        await expectNoHorizontalScroll(page, size.width)
        await expectNothingClipped(page)

        await page.goto('/system-status')
        await expect(page.getByText('Online', { exact: true })).toBeVisible()
        await check('system-status')
      })
    }
  }
})

test.describe('RESP-06 (AC-48): the Actions Taken table or its cards, never both', () => {
  for (const role of ['staff', 'requester'] as const) {
    test(`${role}: table from 768px, cards below it`, async ({ page }) => {
      await loginAs(page, role)
      await page.setViewportSize({ width: 768, height: 900 })
      await page.goto(role === 'staff' ? `/staff/tickets/${ticket.id}` : `/tickets/${ticket.id}`)
      const area = actionsArea(page)
      await expect(area.getByText('3 Actions Taken', { exact: true })).toBeVisible()

      await expect(area.getByRole('table')).toBeVisible()
      await expect(area.locator('.ttk-actions__cards')).toBeHidden()
      await expect(area.getByRole('button', { name: /^View the Action Taken/ })).toHaveCount(3)

      await page.setViewportSize({ width: 767, height: 900 })
      await expect(area.getByRole('table')).toBeHidden()
      await expect(area.locator('.ttk-actions__cards')).toBeVisible()
      // Hidden means out of the accessibility tree too: three rows are
      // announced, not six.
      await expect(area.getByRole('button', { name: /^View the Action Taken/ })).toHaveCount(3)
      await expectNoHorizontalScroll(page, 767)
    })
  }

  test('long text is cut to three lines in the list and whole in the dialog', async ({ page }) => {
    await loginAs(page, 'staff')
    await openStaffTicket(page)
    const row = actionsArea(page).getByRole('row').filter({ hasText: 'Full log saved as' })
    const clamp = row.locator('.ttk-actions__clamp').first()
    const lines = await clamp.evaluate((el) => el.clientHeight / parseFloat(getComputedStyle(el).lineHeight))
    expect(lines).toBeLessThanOrEqual(3.1)
    expect(await clamp.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

    await row.getByRole('button', { name: /^View the Action Taken/ }).click()
    const view = page.getByRole('dialog', { name: 'Action Taken', exact: true })
    await expect(view.getByText('Cleaned the intake filter', { exact: false })).toBeVisible()
    const whole = view.locator('dd').filter({ hasText: 'Swapped the lamp module' })
    expect(await whole.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
  })
})

test.describe('RESP-02 (ui-spec §10): the Lab 4 screens are made of the same parts as the earlier ones', () => {
  test('card surface, table header, headings and links match Lab 2 and Lab 3', async ({ page }) => {
    // The references: a Lab 2 card and table, and the Lab 3 queue table.
    await loginAs(page, 'requester')
    await page.goto(`/tickets/${ticket.id}`)
    await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
    await expect(actionsArea(page).getByRole('table')).toBeVisible()
    const lab2Card = await surfaceOf(page.locator('.ttk-detail__card'))
    const lab3Section = await typeOf(page.locator('.ttk-thread__title').filter({ hasText: 'Comments' }))

    // Actions Taken sits on the same card, under the same kind of heading.
    expect(await surfaceOf(actionsArea(page))).toBe(lab2Card)
    expect(await typeOf(actionsArea(page).getByRole('heading', { name: 'Actions Taken' }))).toBe(lab3Section)
    const actionsHeader = await surfaceOf(actionsArea(page).locator('thead th'))
    const actionsHeaderType = await typeOf(actionsArea(page).locator('thead th'))

    await page.goto('/tickets')
    await expect(page.getByRole('table')).toBeVisible()
    const lab2Heading = await typeOf(page.getByRole('heading', { name: 'My Tickets' }))
    const lab2Header = await surfaceOf(page.locator('.ttk-my-tickets__table thead th'))
    const lab2HeaderType = await typeOf(page.locator('.ttk-my-tickets__table thead th'))
    const lab2Link = await typeOf(page.locator('.ttk-my-tickets__table tbody a'))
    expect(actionsHeader).toBe(lab2Header)
    expect(actionsHeaderType).toBe(lab2HeaderType)

    await page.goto('/dashboard')
    await expect(page.getByTestId('metric-openTickets')).toBeVisible()
    expect(await surfaceOf(page.getByTestId('metric-openTickets'))).toBe(lab2Card)
    expect(await surfaceOf(page.getByTestId('list-recently-updated'))).toBe(lab2Card)
    expect(await typeOf(page.getByRole('heading', { name: /^Welcome/ }))).toBe(lab2Heading)
    // A Ticket Number in a dashboard row reads as the link it is in My Tickets.
    const [family, size, , colour] = lab2Link.split(' | ')
    const lead = (await typeOf(page.locator('.ttk-dash-row__lead'))).split(' | ')
    expect([lead[0], lead[1], lead[3]]).toEqual([family, size, colour])
    expect((await typeOf(page.locator('.ttk-dash-list__all'))).split(' | ')[3]).toBe(colour)
    await page.context().clearCookies()

    await loginAs(page, 'staff')
    await page.goto('/staff/tickets')
    await expect(page.getByRole('table')).toBeVisible()
    const lab3Heading = await typeOf(page.getByRole('heading', { name: 'Ticket Queue' }))
    expect(await surfaceOf(page.locator('.ttk-queue__table thead th'))).toBe(actionsHeader)

    await page.goto('/staff/dashboard')
    await expect(page.getByTestId('by-status')).toBeVisible()
    expect(await surfaceOf(page.getByTestId('metric-unassigned'))).toBe(lab2Card)
    expect(await surfaceOf(page.getByTestId('by-status'))).toBe(lab2Card)
    expect(await typeOf(page.getByRole('heading', { name: /^Welcome back/ }))).toBe(lab3Heading)
  })

  test('the dialog uses the buttons and fields of the earlier forms', async ({ page }) => {
    const control = (locator: Locator) =>
      locator.first().evaluate((el) => {
        const style = getComputedStyle(el)
        return [style.backgroundColor, style.color, style.borderRadius, style.fontWeight, style.fontFamily, style.minHeight].join('|')
      })

    await loginAs(page, 'requester')
    await page.goto('/tickets/new')
    const lab2Primary = await control(page.getByRole('button', { name: 'Create Ticket' }))
    const lab2Secondary = await control(page.locator('.ttk-btn--secondary'))
    const lab2Field = await control(page.getByLabel(/^Summary/))
    const lab2Area = await control(page.getByLabel(/^Description/))
    await page.context().clearCookies()

    await loginAs(page, 'staff')
    await openStaffTicket(page)
    const add = actionsArea(page).getByRole('button', { name: 'Add Action Taken' })
    expect(await control(add)).toBe(lab2Primary)
    await add.click()
    const dialog = page.getByRole('dialog', { name: 'Add Action Taken' })
    expect(await control(dialog.getByRole('button', { name: 'Save Action Taken' }))).toBe(lab2Primary)
    expect(await control(dialog.getByRole('button', { name: 'Cancel' }))).toBe(lab2Secondary)
    expect(await control(dialog.getByLabel(/^Attachment Notes/))).toBe(lab2Field)
    expect(await control(dialog.getByLabel(/^Action Description/))).toBe(lab2Area)
  })
})

test.describe('dashboards: every number is a link that says what it counts', () => {
  test('cards and rows carry their count in their name, and zero is 0', async ({ page }) => {
    await asIdle(page)
    await page.goto('/staff/dashboard')
    await expect(page.getByTestId('by-status')).toBeVisible()

    // Somebody who owns nothing and has recorded nothing.
    await expect(page.getByTestId('metric-myTickets-value')).toHaveText('0')
    await expect(page.getByTestId('metric-myActionsToday-value')).toHaveText('0')
    await expect(page.getByTestId('metric-myTickets')).toHaveAccessibleName('My Tickets, 0, view all')
    // A zero is still a way into the list it counts.
    await expect(page.getByTestId('metric-myTickets')).toHaveAttribute('href', /owner=me/)

    for (const key of ['unassigned', 'myTickets', 'urgent']) {
      const value = (await page.getByTestId(`metric-${key}-value`).textContent())!.trim()
      expect(value).toMatch(/^\d+$/)
      await expect(page.getByTestId(`metric-${key}`)).toHaveAccessibleName(new RegExp(`, ${value}, view all$`))
    }
    // My Actions Today leads nowhere, so it is not dressed as a link.
    expect(await page.getByTestId('metric-myActionsToday').evaluate((el) => el.tagName)).toBe('DIV')

    // All eight statuses, each a link naming its count.
    const statuses = page.getByTestId('by-status').getByRole('link')
    await expect(statuses).toHaveCount(8)
    const names = await statuses.evaluateAll((links) => links.map((link) => link.getAttribute('aria-label') ?? ''))
    for (const name of names) expect(name).toMatch(/^.+, \d+, view all$/)

    // An empty list keeps its place and says so in a line.
    const mine = page.getByTestId('list-my-actions')
    await expect(mine.getByRole('heading', { name: 'My recent Actions Taken' })).toBeVisible()
    await expect(mine.getByText('You have not recorded any Actions Taken yet.')).toBeVisible()
    await expect(mine.getByRole('link')).toHaveCount(0)

    // Every row of a list that has rows is one link.
    const rows = page.getByTestId('list-recently-updated').locator('li')
    expect(await rows.count()).toBeGreaterThan(0)
    for (const row of await rows.all()) await expect(row.getByRole('link')).toHaveCount(1)
  })

  test('Dashboard is first in every role’s navigation, with one item current on every route', async ({ page }) => {
    const ROUTES = {
      requester: ['/dashboard', '/tickets', '/tickets/new', `/tickets/${ticket.id}`],
      staff: ['/staff/dashboard', '/staff/tickets', `/staff/tickets/${ticket.id}`],
      admin: ['/staff/dashboard', '/staff/tickets', `/staff/tickets/${ticket.id}`, '/admin/users', '/system-status'],
    } as const

    for (const role of ['requester', 'staff', 'admin'] as const) {
      await page.context().clearCookies()
      await loginAs(page, role)
      for (const route of ROUTES[role]) {
        await page.goto(route)
        const nav = page.getByRole('navigation', { name: 'Primary' })
        await expect(nav.getByRole('link').first(), `${role} at ${route}`).toHaveText('Dashboard')
        await expect(nav.locator('[aria-current="page"]'), `${role} at ${route}`).toHaveCount(1)
      }
    }
  })
})

test.describe('RESP-03 (ui-spec §6.3): what can be edited, and what cannot', () => {
  test('Performed by and Recorded are text, on a different surface from the fields', async ({ page }) => {
    await loginAs(page, 'staff')
    await openStaffTicket(page)
    const background = (locator: Locator) => locator.first().evaluate((el) => getComputedStyle(el).backgroundColor)
    const typable = 'input, textarea, select, [contenteditable="true"]'

    await actionsArea(page).getByRole('button', { name: 'Add Action Taken' }).click()
    const create = page.getByRole('dialog', { name: 'Add Action Taken' })
    const performer = create.locator('.ttk-actions__performer dd')
    await expect(performer).toHaveText('Sarah Chen (you)')
    expect(await performer.evaluate((el) => el.matches('input, textarea, select') || el.tabIndex >= 0)).toBe(false)
    expect(await background(performer)).not.toBe(await background(create.getByLabel(/^Action Description/)))
    await expect(create.locator('.ttk-actions__performer').locator(typable)).toHaveCount(0)
    await page.keyboard.press('Escape')

    // View mode: every field is there, and none of them can be typed into.
    await viewButton(page, 'Full log saved as').click()
    const view = page.getByRole('dialog', { name: 'Action Taken', exact: true })
    await expect(view.locator(typable)).toHaveCount(0)
    const recorded = view.locator('.ttk-detail__field').filter({ hasText: 'Recorded' }).locator('dd')
    await expect(recorded).toBeVisible()
    const readOnlySurface = await background(recorded)

    await view.getByRole('button', { name: 'Edit' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit Action Taken' })
    await expect(edit.locator('.ttk-actions__performer dd')).toHaveText('Sarah Chen. Cannot be changed.')
    expect(await background(edit.locator('.ttk-actions__performer dd'))).toBe(readOnlySurface)
    expect(readOnlySurface).not.toBe(await background(edit.getByLabel(/^Result/)))
  })

  test('the Requester’s view of Actions Taken holds no control but View', async ({ page }) => {
    await loginAs(page, 'requester')
    await page.goto(`/tickets/${ticket.id}`)
    const area = actionsArea(page)
    await expect(area.getByText('3 Actions Taken', { exact: true })).toBeVisible()
    await expect(area.locator('input, textarea, select')).toHaveCount(0)
    await expect(area.getByRole('button').filter({ hasNotText: 'View' })).toHaveCount(0)

    await viewButton(page, 'Full log saved as').click()
    const view = page.getByRole('dialog', { name: 'Action Taken', exact: true })
    await expect(view.locator('input, textarea, select')).toHaveCount(0)
    await expect(view.getByRole('button')).toHaveText(['Close'])
  })
})

test.describe('validation messages sit directly below their own field', () => {
  test('the Action Taken dialog', async ({ page }) => {
    await loginAs(page, 'staff')
    await openStaffTicket(page)
    await actionsArea(page).getByRole('button', { name: 'Add Action Taken' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add Action Taken' })

    await dialog.getByLabel('Follow-Up Required?').check()
    await dialog.getByRole('button', { name: 'Save Action Taken' }).click()

    await expectMessageUnder(dialog.getByLabel(/^Action Description/), 'Action Description')
    await expectMessageUnder(dialog.getByLabel(/^Result/), 'Result')
    await expectMessageUnder(dialog.getByLabel(/^Follow-up Note/), 'Follow-up Note')
    // The first field that is wrong is where the cursor goes.
    await expect(dialog.getByLabel(/^Action Description/)).toBeFocused()
    // The one that was right has no message.
    await expect(dialog.getByLabel(/^Action Date\/Time/)).not.toHaveAttribute('aria-invalid', 'true')
  })
})

test.describe('RESP-04 (AC-49): focus is visible, and the dialog keeps it', () => {
  test('both dashboards', async ({ page }) => {
    await loginAs(page, 'staff')
    await page.goto('/staff/dashboard')
    await expect(page.getByTestId('by-status')).toBeVisible()
    await expect(page.getByTestId('list-my-actions').getByRole('link').first()).toBeVisible()
    const staff = await tabThrough(page, 30)
    expect(staff.size).toBeGreaterThanOrEqual(18)
    // Far enough down the page to have reached the cards, the statuses and a row.
    expect([...staff].some((name) => /^a "Unassigned, \d+, view all"/.test(name))).toBe(true)
    expect([...staff].some((name) => /^a "Cancelled, \d+, view all"/.test(name))).toBe(true)
    await page.context().clearCookies()

    await loginAs(page, 'requester')
    await page.goto('/dashboard')
    await expect(page.getByTestId('list-needs-attention').getByRole('link').first()).toBeVisible()
    const requester = await tabThrough(page, 20)
    expect(requester.size).toBeGreaterThanOrEqual(12)
    expect([...requester].some((name) => /^a "Waiting for You, \d+, view all"/.test(name))).toBe(true)
  })

  test('the Actions Taken area', async ({ page }) => {
    await loginAs(page, 'staff')
    await openStaffTicket(page)
    // Start from the control above the area, so the walk is through it.
    await actionsArea(page).getByRole('button', { name: 'Add Action Taken' }).focus()
    const visited = await tabThrough(page, 3)
    expect([...visited].filter((name) => name.includes('View the Action Taken'))).toHaveLength(3)
  })

  test('the dialog traps focus, shows it, and gives it back', async ({ page }) => {
    await loginAs(page, 'staff')
    await openStaffTicket(page)
    const opener = actionsArea(page).getByRole('button', { name: 'Add Action Taken' })
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Add Action Taken' })
    await expect(dialog.getByLabel(/^Action Date\/Time/)).toBeFocused()

    // More presses than the dialog has controls: focus must come back round.
    const visited = await tabThrough(page, 16, dialog)
    expect(visited.size).toBeGreaterThanOrEqual(6)

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()

    // And from a row: back to that row's own View.
    const view = viewButton(page, 'Reset the lamp-hours counter')
    await view.click()
    await tabThrough(page, 4, page.getByRole('dialog', { name: 'Action Taken', exact: true }))
    await page.keyboard.press('Escape')
    await expect(view).toBeFocused()
  })
})

test.describe('RESP-05 (AC-49): nothing is said by colour alone', () => {
  test('follow-up is a worded badge, and the blocked move says why in words', async ({ page }) => {
    await loginAs(page, 'staff')
    await openStaffTicket(page)
    const area = actionsArea(page)

    const required = await badgeLook(area.locator('.ttk-badge', { hasText: 'Follow-up required' }))
    const none = await badgeLook(area.locator('.ttk-badge', { hasText: 'No follow-up' }))
    expect(required.text).toBe('Follow-up required')
    expect(none.text).toBe('No follow-up')
    expect(required.signature).not.toBe(none.signature)

    // Status, IT Priority and follow-up, side by side on this Ticket.
    const workflow = page.getByRole('region', { name: 'Workflow' })
    const status = await badgeLook(workflow.locator('.ttk-badge', { hasText: 'In Progress' }))
    const itPriority = await badgeLook(workflow.locator('.ttk-badge', { hasText: 'Urgent' }))
    const looks = [status.signature, itPriority.signature, required.signature]
    expect(new Set(looks).size, `status, IT Priority and follow-up look alike: ${looks.join(' / ')}`).toBe(3)

    // AC-27: the move that is held back is disabled, and its reason is text
    // beside the control, not a colour or a tooltip.
    const move = workflow.getByLabel('Move to')
    await expect(move.getByRole('option', { name: /^Resolved/ })).toBeDisabled()
    await expect(move.getByRole('option', { name: /^Resolved/ })).toHaveText('Resolved (not available yet)')
    const reason = workflow.getByTestId('blocked-RESOLVED')
    await expect(reason).toBeVisible()
    await expect(reason).toContainText('The latest Action Taken still requires follow-up')
    const [control, text] = [await move.boundingBox(), await reason.boundingBox()]
    expect(text!.y - (control!.y + control!.height), 'the reason is far from the control').toBeLessThan(120)
    expect(text!.y, 'the reason is not below the control').toBeGreaterThanOrEqual(control!.y)
  })

  for (const theme of THEMES) {
    test(`every badge label is readable on its own fill (${theme})`, async ({ page }) => {
      await setTheme(page, theme)
      await loginAs(page, 'staff')

      const badges: { text: string; contrast: number; where: string }[] = []
      const collect = async (where: string) => {
        for (const badge of await page.locator('main .ttk-badge:visible').all()) {
          badges.push({ ...(await badgeLook(badge)), where })
        }
      }

      await page.goto('/staff/dashboard')
      await expect(page.getByTestId('by-status')).toBeVisible()
      await expect(page.getByTestId('list-my-actions').getByRole('link').first()).toBeVisible()
      await collect('IT Staff Dashboard')
      await openStaffTicket(page)
      await collect('staff Ticket Detail')
      await page.context().clearCookies()
      await loginAs(page, 'requester')
      await page.goto('/dashboard')
      await expect(page.getByTestId('list-needs-attention').getByRole('link').first()).toBeVisible()
      await collect('Requester Dashboard')

      // Enough variety for this to mean something: the eight statuses, the
      // priorities and both follow-up states.
      expect(new Set(badges.map((badge) => badge.text)).size).toBeGreaterThanOrEqual(11)
      for (const badge of badges) {
        expect(badge.text.length, `a badge with no label on ${badge.where}`).toBeGreaterThan(0)
        // WCAG AA for text this size.
        expect(badge.contrast, `"${badge.text}" on ${badge.where}, ${theme}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  test('who reads what is said in words: Internal Notes apart, Actions Taken shared', async ({ page }) => {
    await loginAs(page, 'staff')
    await openStaffTicket(page)
    const surface = (locator: Locator) =>
      locator.evaluate((el) => {
        const style = getComputedStyle(el)
        return { background: style.backgroundColor, rule: parseFloat(style.borderLeftWidth) }
      })
    const notes = await surface(page.locator('.ttk-thread--internal'))
    const shared = await surface(actionsArea(page))

    // Internal Notes keep the surface and rule Lab 3 gave them, and the new
    // area, which the Requester does read, is not drawn like them.
    expect(notes.rule).toBeGreaterThanOrEqual(3)
    expect(shared.background).not.toBe(notes.background)
    expect(shared.rule).toBeLessThan(3)
    await expect(actionsArea(page).getByText('Work recorded on this Ticket. Visible to the Requester.')).toBeVisible()
    await expect(page.locator('.ttk-thread--internal').getByText(/The Requester never sees these/).first()).toBeVisible()
  })
})
