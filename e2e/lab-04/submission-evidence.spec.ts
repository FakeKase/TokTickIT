import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { runCleanup } from '../cleanup'
import {
  ACCOUNTS,
  API,
  DEV_PASSWORD,
  FIXTURE_MARKER,
  VIEWPORTS,
  actionsArea,
  attachFile,
  cookieFor,
  createTicket,
  createUser,
  editAction,
  firstRequester,
  loginAs,
  recordAction,
  requesterWithoutTickets,
  secondRequester,
  sessionAs,
  settlePassword,
  shot,
  signInThroughForm,
  workflowChange,
} from './helpers'

/**
 * Screenshots for the submission PDF (handout §14, Parts 5 to 9), at the paths
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

const describeIt = { description: `Reported during the ${FIXTURE_MARKER}.` }
const workflowOf = (page: Page) => page.getByRole('region', { name: 'Workflow' })

type Made = { id: number; ticketNumber: string }

/** A Ticket of Peter's, owned by Sarah and In Progress. */
async function ownedInProgress(request: APIRequestContext, summary: string): Promise<Made> {
  const ticket = (await createTicket(request, await firstRequester(request), {
    summary,
    ...describeIt,
    requestedPriority: 'MEDIUM',
  })) as Made
  const sarah = await cookieFor(request, ACCOUNTS.staff.email)
  const me = (await (await request.get(`${API}/api/auth/me`, { headers: { Cookie: sarah } })).json()).user
  await workflowChange(request, ticket.id, 'owner', { ownerId: me.id }, sarah)
  await workflowChange(request, ticket.id, 'status', { currentStatus: 'IN_PROGRESS' }, sarah)
  return ticket
}

/** A table of results as a page, so it can go in the PDF as an image. */
async function renderTable(page: Page, title: string, lead: string, head: string[], rows: string[][]) {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.setContent(`<!doctype html><html><head><style>
    body { font: 15px/1.45 -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1f2e27; margin: 24px; }
    h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 0 0 16px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #cbd5ce; vertical-align: top; }
    th { background: #eaf6ef; } td { font: 13px ui-monospace, Menlo, monospace; overflow-wrap: anywhere; }
    td:first-child { font: inherit; font-weight: 600; white-space: nowrap; }
  </style></head><body>
    <h1>${escape(title)}</h1><p>${escape(lead)}</p>
    <table><thead><tr>${head.map((cell) => `<th>${escape(cell)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></body></html>`)
  await expect(page.getByRole('row')).toHaveCount(rows.length + 1)
}

test.describe('Part 5: the IT Staff Dashboard', () => {
  let worked: Made

  test.beforeAll(async ({ request }) => {
    // Something for "My recent Actions Taken" and "My Actions Today" to show.
    worked = await ownedInProgress(request, 'Projector in LX-204 will not power on')
    const sarah = await cookieFor(request, ACCOUNTS.staff.email)
    await workflowChange(request, worked.id, 'it-priority', { itPriority: 'URGENT' }, sarah)
    await recordAction(request, worked.id, sarah, {
      description: 'Replaced the lamp module.',
      result: 'Powers on. The lamp-hours counter did not reset.',
      followUpRequired: true,
      followUpNote: 'Reset the counter with the service remote.',
    })
  })

  for (const viewport of ['desktop', 'tablet', 'mobile'] as const) {
    test(`the dashboard at ${viewport} width`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[viewport])
      await loginAs(page, 'staff')
      await page.goto('/staff/dashboard')
      await expect(page.getByTestId('by-status')).toBeVisible()
      await expect(page.getByTestId('list-my-actions').getByRole('link').first()).toBeVisible()
      await capture(page, 'staff-dashboard', viewport)
    })
  }

  test('every count beside the same count made in SQL', async ({ page }) => {
    await loginAs(page, 'staff')
    await page.goto('/staff/dashboard')
    await expect(page.getByTestId('by-status')).toBeVisible()

    const shown = new Map<string, string>()
    for (const key of ['unassigned', 'myTickets', 'urgent', 'myActionsToday']) {
      shown.set(key, (await page.getByTestId(`metric-${key}-value`).textContent())!.trim())
    }
    for (const link of await page.getByTestId('by-status').getByRole('link').all()) {
      const status = new URL((await link.getAttribute('href'))!, 'http://x').searchParams.get('status')!
      shown.set(`status ${status}`, (await link.locator('.ttk-dash-status__count').textContent())!.trim())
    }

    // The same database, asked directly, by a script that shares no code
    // with the dashboard: see server/src/scripts/dashboard-sql-check.ts.
    const counted = JSON.parse(
      execFileSync('npx', ['tsx', 'src/scripts/dashboard-sql-check.ts', ACCOUNTS.staff.email], {
        cwd: 'server',
        encoding: 'utf-8',
      })
        .trim()
        .split('\n')
        .pop()!,
    ) as { metric: string; sql: string; value: number }[]

    expect(counted).toHaveLength(12)
    for (const row of counted) {
      expect([row.metric, shown.get(row.metric)]).toEqual([row.metric, String(row.value)])
    }
    // Enough is counted for agreement to mean something.
    expect(counted.reduce((sum, row) => sum + row.value, 0)).toBeGreaterThan(8)

    await renderTable(
      page,
      `IT Staff Dashboard for ${ACCOUNTS.staff.name}, against the database`,
      'Each number read from the screen, and the result of one SQL query run against the same database a moment later.',
      ['Metric', 'Dashboard', 'SQL result', 'Query'],
      counted.map((row) => [row.metric, shown.get(row.metric)!, String(row.value), row.sql]),
    )
    await capture(page, 'staff-dashboard', 'metric-vs-database')
  })

  test('a count opens the Tickets it counted', async ({ page }) => {
    await loginAs(page, 'staff')
    await page.goto('/staff/dashboard')
    const unassigned = (await page.getByTestId('metric-unassigned-value').textContent())!.trim()
    await page.getByTestId('metric-unassigned').click()
    await expect(page).toHaveURL(/owner=unassigned&status=ACTIVE/)
    await expect(page.getByTestId('list-total')).toContainText(unassigned)
    await capture(page, 'staff-dashboard', 'drill-down-unassigned')

    await page.goto('/staff/dashboard')
    const row = page.getByTestId('by-status').getByRole('link', { name: /^In Progress/ })
    const inProgress = (await row.locator('.ttk-dash-status__count').textContent())!.trim()
    await row.click()
    await expect(page).toHaveURL(/status=IN_PROGRESS$/)
    await expect(page.getByTestId('list-total')).toContainText(inProgress)
    await expect(page.getByLabel('Status')).toHaveValue('IN_PROGRESS')
    await capture(page, 'staff-dashboard', 'drill-down-status')
  })

  test('a recent action opens its Ticket at Actions Taken', async ({ page }) => {
    await loginAs(page, 'staff')
    await page.goto('/staff/dashboard')
    const list = page.getByTestId('list-my-actions')
    await expect(list.getByRole('link').first()).toContainText(worked.ticketNumber)
    await list.screenshot({ path: shot('staff-dashboard', 'my-recent-actions') })

    await list.getByRole('link').first().click()
    await expect(page).toHaveURL(new RegExp(`/staff/tickets/${worked.id}#actions-taken$`))
    await expect(actionsArea(page)).toBeInViewport()
  })

  test('the Administrator’s user counts, and somebody with nothing to count', async ({ page, request }) => {
    await loginAs(page, 'admin')
    await page.goto('/staff/dashboard')
    await expect(page.getByTestId('user-accounts')).toBeVisible()
    await capture(page, 'staff-dashboard', 'admin-user-counts')
    await page.context().clearCookies()

    const idle = await createUser(request, { name: 'Imani Idle', role: 'IT_STAFF', label: 'evidence-idle' })
    await settlePassword(request, idle, 'Settled123!')
    await signInThroughForm(page, idle.email, 'Settled123!')
    await expect(page).toHaveURL(/\/staff\/dashboard$/)
    await expect(page.getByTestId('metric-myTickets-value')).toHaveText('0')
    await expect(page.getByTestId('metric-myActionsToday-value')).toHaveText('0')
    await expect(page.getByText('You have not recorded any Actions Taken yet.')).toBeVisible()
    await capture(page, 'staff-dashboard', 'zero-metrics')
  })

  test('loading, a failed load, and a Requester at this address', async ({ page }) => {
    await loginAs(page, 'staff')
    // Hold the request open so the loading state can be photographed.
    await page.route('**/api/dashboard/staff', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500))
      await route.continue()
    })
    await page.goto('/staff/dashboard')
    await expect(page.getByText('Loading the dashboard…')).toBeVisible()
    await capture(page, 'staff-dashboard', 'loading')
    await expect(page.getByTestId('by-status')).toBeVisible()
    await page.unroute('**/api/dashboard/staff')

    // AC-34: no number beside the failure, nothing internal, and a way to retry.
    await page.route('**/api/dashboard/staff', (route) => route.abort())
    await page.goto('/staff/dashboard')
    await expect(page.getByRole('alert').getByText('Unable to load the dashboard')).toBeVisible()
    await expect(page.getByTestId('metric-unassigned')).toHaveCount(0)
    await capture(page, 'staff-dashboard', 'failure')
    await page.unroute('**/api/dashboard/staff')
    await page.context().clearCookies()

    await loginAs(page, 'requester')
    await page.goto('/staff/dashboard')
    await expect(page.getByRole('alert')).toContainText('do not have permission')
    await capture(page, 'staff-dashboard', 'forbidden', false)
  })
})

test.describe('Part 5: the Requester Dashboard', () => {
  let waiting: Made
  let theirs: Made

  test.beforeAll(async ({ request }) => {
    waiting = (await createTicket(request, await firstRequester(request), {
      summary: 'Which room is the faulty projector in?',
      ...describeIt,
    })) as Made
    const sarah = await cookieFor(request, ACCOUNTS.staff.email)
    await workflowChange(request, waiting.id, 'status', { currentStatus: 'OPEN' }, sarah)
    await workflowChange(request, waiting.id, 'status', { currentStatus: 'WAITING_FOR_REQUESTER' }, sarah)
    theirs = (await createTicket(request, await secondRequester(request), {
      summary: 'Somebody else entirely: VPN drops every few minutes',
      ...describeIt,
    })) as Made
  })

  for (const viewport of ['desktop', 'tablet', 'mobile'] as const) {
    test(`the dashboard at ${viewport} width`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[viewport])
      await loginAs(page, 'requester')
      await page.goto('/dashboard')
      await expect(page.getByTestId('list-needs-attention').getByRole('link').first()).toBeVisible()
      // AC-02: nobody else's Ticket is on it.
      await expect(page.getByRole('main')).not.toContainText(theirs.ticketNumber)
      await capture(page, 'requester-dashboard', viewport)
    })
  }

  test('what is waiting on them, and a count followed into My Tickets', async ({ page }) => {
    await loginAs(page, 'requester')
    await page.goto('/dashboard')
    const attention = page.getByTestId('list-needs-attention')
    await expect(attention.getByRole('link', { name: new RegExp(waiting.ticketNumber) })).toBeVisible()
    await attention.screenshot({ path: shot('requester-dashboard', 'needs-attention') })

    const open = (await page.getByTestId('metric-openTickets-value').textContent())!.trim()
    await page.getByTestId('metric-openTickets').click()
    await expect(page).toHaveURL(/\/tickets\?status=ACTIVE$/)
    await expect(page.getByTestId('list-total')).toContainText(open)
    await expect(page.getByLabel('Status', { exact: true })).toHaveValue('ACTIVE')
    await capture(page, 'requester-dashboard', 'drill-down-active')
  })

  test('a Requester with no Tickets', async ({ page, request }) => {
    const empty = await requesterWithoutTickets(request)
    await signInThroughForm(page, empty.email, DEV_PASSWORD)
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole('heading', { name: 'You have not created any Tickets yet' })).toBeVisible()
    await expect(page.getByTestId('metric-openTickets-value')).toHaveText('0')
    await capture(page, 'requester-dashboard', 'empty-account')
  })

  test('whose Tickets are counted is decided by the session, whatever is asked', async ({ page, playwright }) => {
    const nobody = await sessionAs(playwright)
    const peter = await sessionAs(playwright, ACCOUNTS.requester.email)
    const ned = await sessionAs(playwright, 'ned.leeds@toktickit.test')
    const sarah = await sessionAs(playwright, ACCOUNTS.staff.email)
    const peterId = (await (await peter.get('/api/auth/me')).json()).user.id as number

    const own = await ned.get('/api/dashboard/requester')
    const attempts = [
      { who: 'Nobody (no session)', call: 'read a Requester Dashboard', session: nobody, path: '/api/dashboard/requester', status: 401 },
      { who: 'IT Staff', call: 'read a Requester Dashboard', session: sarah, path: '/api/dashboard/requester', status: 403 },
      { who: 'Requester', call: 'read the IT Staff Dashboard', session: peter, path: '/api/dashboard/staff', status: 403 },
      { who: 'Another Requester', call: "ask for Peter's dashboard by id", session: ned, path: `/api/dashboard/requester?requesterId=${peterId}`, status: 200 },
      { who: 'Another Requester', call: "ask for Peter's dashboard by user id", session: ned, path: `/api/dashboard/requester?userId=${peterId}`, status: 200 },
      { who: 'Another Requester', call: "open Peter's Ticket", session: ned, path: `/api/tickets/${waiting.id}`, status: 404 },
    ]

    const rows: string[][] = []
    for (const attempt of attempts) {
      const response = await attempt.session.get(attempt.path)
      const body = await response.text()
      expect([attempt.who, attempt.call, response.status()]).toEqual([attempt.who, attempt.call, attempt.status])
      // Nothing of Peter's reaches anybody else, in a refusal or otherwise.
      expect(body).not.toContain(waiting.ticketNumber)

      let outcome = body
      if (response.status() === 200) {
        // The parameter was ignored: the answer is their own dashboard.
        expect(JSON.parse(body).metrics).toEqual((await own.json()).metrics)
        expect(body).toContain(theirs.ticketNumber)
        outcome = `Their own dashboard, unchanged: ${theirs.ticketNumber} is on it and ${waiting.ticketNumber} is not.`
      }
      rows.push([attempt.who, attempt.call, `GET ${attempt.path}`, String(response.status()), outcome])
    }

    await renderTable(
      page,
      'Dashboard requests, made with a real session for each role',
      'Each row is one request sent straight to the API, with no screen involved, and the response it received.',
      ['Who', 'Tried to', 'Request', 'Status', 'Response'],
      rows,
    )
    await capture(page, 'requester-dashboard', 'ownership-api')
  })

  test('a failed load, and IT Staff at this address', async ({ page }) => {
    await loginAs(page, 'requester')
    await page.route('**/api/dashboard/requester', (route) => route.abort())
    await page.goto('/dashboard')
    await expect(page.getByRole('alert').getByText('Unable to load your dashboard')).toBeVisible()
    await expect(page.getByTestId('metric-openTickets')).toHaveCount(0)
    await capture(page, 'requester-dashboard', 'failure')
    await page.unroute('**/api/dashboard/requester')
    await page.context().clearCookies()

    await loginAs(page, 'staff')
    await page.goto('/dashboard')
    await expect(page.getByRole('alert')).toContainText('do not have permission')
    await capture(page, 'requester-dashboard', 'forbidden', false)
  })
})

test.describe('Part 6: Actions Taken', () => {
  let ticket: Made
  const FIRST = {
    description: 'Checked the charger and both ports with a known good laptop.',
    result: 'The charger is dead. The ports are fine.',
    followUp: 'Hand over the replacement charger when the Requester comes by.',
  }

  test.beforeAll(async ({ request }) => {
    ticket = (await createTicket(request, await firstRequester(request), {
      summary: 'Laptop will not charge at my desk',
      ...describeIt,
      requestedPriority: 'MEDIUM',
    })) as Made
    // Owned by Marcus, so neither person who records work below is its owner.
    const marcus = await cookieFor(request, ACCOUNTS.colleague.email)
    const me = (await (await request.get(`${API}/api/auth/me`, { headers: { Cookie: marcus } })).json()).user
    await workflowChange(request, ticket.id, 'owner', { ownerId: me.id }, marcus)
    await workflowChange(request, ticket.id, 'status', { currentStatus: 'IN_PROGRESS' }, marcus)
  })

  // Tall enough for the whole dialog: it scrolls inside its backdrop, and a
  // capture of it would otherwise stop at the bottom of the window.
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 })
  })

  test('recording work: the form, its validation, and a follow-up', async ({ page }) => {
    await loginAs(page, 'staff')
    await page.goto(`/staff/tickets/${ticket.id}`)
    const area = actionsArea(page)
    await expect(area.getByText('No Actions Taken have been recorded for this Ticket yet.')).toBeVisible()

    await area.getByRole('button', { name: 'Add Action Taken' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add Action Taken' })
    await dialog.getByLabel('Follow-Up Required?').check()
    await dialog.getByRole('button', { name: 'Save Action Taken' }).click()
    await expect(dialog.getByText('Say what follow-up is needed.')).toBeVisible()
    await expect(dialog.getByLabel(/^Action Description/)).toBeFocused()
    await dialog.screenshot({ path: shot('actions-taken', 'validation') })

    await dialog.getByLabel(/^Action Description/).fill(FIRST.description)
    await dialog.getByLabel(/^Result/).fill(FIRST.result)
    await dialog.getByLabel(/^Follow-up Note/).fill(FIRST.followUp)
    await dialog.getByLabel(/^Attachment Notes/).fill('Photo of the charger label: charger-label.jpg')
    await expect(dialog.getByText('Sarah Chen (you)')).toBeVisible()
    await dialog.screenshot({ path: shot('actions-taken', 'create') })

    await dialog.getByRole('button', { name: 'Save Action Taken' }).click()
    await expect(dialog).toBeHidden()
    await expect(area.getByRole('row').filter({ hasText: FIRST.description })).toContainText('Follow-up required')
    await area.screenshot({ path: shot('actions-taken', 'follow-up-required') })
  })

  test('a second person records work, and corrects the first', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto(`/staff/tickets/${ticket.id}`)
    const area = actionsArea(page)
    await area.getByRole('button', { name: 'Add Action Taken' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add Action Taken' })
    await dialog.getByLabel(/^Action Description/).fill('Issued a replacement charger from stock.')
    await dialog.getByLabel(/^Result/).fill('Laptop charges at full rate.')
    await dialog.getByRole('button', { name: 'Save Action Taken' }).click()
    await expect(dialog).toBeHidden()

    // AC-01: two people, neither the owner, each under their own name.
    await expect(area.getByText('2 Actions Taken', { exact: true })).toBeVisible()
    await expect(area.getByRole('row').filter({ hasText: 'Issued a replacement' })).toContainText('Alex Morgan')
    await expect(area.getByRole('row').filter({ hasText: FIRST.description })).toContainText('Sarah Chen')
    await expect(page.getByTestId('owner-current')).toHaveText('Marcus Reed')
    await area.screenshot({ path: shot('actions-taken', 'two-performers') })

    await area.getByRole('row').filter({ hasText: FIRST.description }).getByRole('button', { name: /^View/ }).click()
    await page.getByRole('dialog', { name: 'Action Taken', exact: true }).getByRole('button', { name: 'Edit' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit Action Taken' })
    await expect(edit.getByText('Sarah Chen. Cannot be changed.')).toBeVisible()
    await edit.getByLabel(/^Result/).fill('The charger is dead (no output on the meter). The ports are fine.')
    await edit.screenshot({ path: shot('actions-taken', 'edit') })

    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(edit).toBeHidden()
    const corrected = area.getByRole('row').filter({ hasText: FIRST.description })
    await expect(corrected).toContainText('Edited by Alex Morgan')
    await expect(corrected).toContainText('Sarah Chen')
    await area.screenshot({ path: shot('actions-taken', 'edited-by') })
    await capture(page, 'actions-taken', 'list')
  })

  test('two people editing the same action: the second is told, and keeps their text', async ({ page, request }) => {
    await loginAs(page, 'staff')
    await page.goto(`/staff/tickets/${ticket.id}`)
    const area = actionsArea(page)
    await area.getByRole('row').filter({ hasText: 'Issued a replacement' }).getByRole('button', { name: /^View/ }).click()
    await page.getByRole('dialog', { name: 'Action Taken', exact: true }).getByRole('button', { name: 'Edit' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit Action Taken' })
    await edit.getByLabel(/^Result/).fill('Laptop charges at full rate. Old charger sent for recycling.')

    // While her form sits open, Alex saves a change to the same row.
    const admin = await cookieFor(request, ACCOUNTS.admin.email)
    const listed = (await (
      await request.get(`${API}/api/tickets/${ticket.id}/actions`, { headers: { Cookie: admin } })
    ).json()) as { id: number; description: string }[]
    const row = listed.find((action) => action.description.startsWith('Issued a replacement'))!
    await editAction(request, ticket.id, row.id, admin, { attachmentNotes: 'Stock sheet line 14.' })

    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(edit.getByRole('alert')).toContainText('changed this Action Taken while you were editing')
    await expect(edit.getByLabel(/^Result/)).toHaveValue('Laptop charges at full rate. Old charger sent for recycling.')
    await edit.screenshot({ path: shot('actions-taken', 'stale-conflict') })
  })

  test('the Requester reads all of it and can change none of it', async ({ page }) => {
    await loginAs(page, 'requester')
    await page.goto(`/tickets/${ticket.id}`)
    const area = actionsArea(page)
    await expect(area.getByText('2 Actions Taken', { exact: true })).toBeVisible()
    await expect(area.getByRole('button', { name: 'Add Action Taken' })).toHaveCount(0)
    await area.getByRole('row').filter({ hasText: FIRST.description }).getByRole('button', { name: /^View/ }).click()
    const view = page.getByRole('dialog', { name: 'Action Taken', exact: true })
    await expect(view.getByText(FIRST.followUp)).toBeVisible()
    await expect(view.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await expect(view.getByRole('textbox')).toHaveCount(0)
    await capture(page, 'actions-taken', 'requester-read-only', false)
    await page.keyboard.press('Escape')

    await page.setViewportSize(VIEWPORTS.mobile)
    await expect(area.locator('.ttk-actions__cards')).toBeVisible()
    await area.screenshot({ path: shot('actions-taken', 'mobile') })
  })

  test('direct API calls are refused, whatever the screen offers', async ({ page, playwright }) => {
    const nobody = await sessionAs(playwright)
    const peter = await sessionAs(playwright, ACCOUNTS.requester.email)
    const ned = await sessionAs(playwright, 'ned.leeds@toktickit.test')
    const sarah = await sessionAs(playwright, ACCOUNTS.staff.email)
    const [anAction] = (await (await sarah.get(`/api/tickets/${ticket.id}/actions`)).json()) as { id: number; version: number }[]
    const work = {
      requestKey: `evidence-refused-${Date.now()}`,
      actionAt: new Date().toISOString(),
      description: 'Should never be saved',
      result: 'Should never be saved',
      followUpRequired: false,
    }

    const attempts = [
      { who: 'Nobody (no session)', call: 'read the Actions Taken', session: nobody, method: 'GET', path: `/api/tickets/${ticket.id}/actions`, status: 401 },
      { who: 'Requester', call: 'record an Action Taken on their own Ticket', session: peter, method: 'POST', path: `/api/tickets/${ticket.id}/actions`, body: work, status: 403 },
      { who: 'Requester', call: 'edit an Action Taken on their own Ticket', session: peter, method: 'PATCH', path: `/api/tickets/${ticket.id}/actions/${anAction.id}`, body: { ...work, expectedVersion: anAction.version }, status: 403 },
      { who: 'Another Requester', call: "read somebody else's Actions Taken", session: ned, method: 'GET', path: `/api/tickets/${ticket.id}/actions`, status: 404 },
      { who: 'Another Requester', call: "record work on somebody else's Ticket", session: ned, method: 'POST', path: `/api/tickets/${ticket.id}/actions`, body: work, status: 403 },
      { who: 'IT Staff', call: 'delete an Action Taken', session: sarah, method: 'DELETE', path: `/api/tickets/${ticket.id}/actions/${anAction.id}`, status: 404 },
    ]

    const rows: string[][] = []
    for (const attempt of attempts) {
      const response = await attempt.session.fetch(attempt.path, { method: attempt.method, data: attempt.body })
      const body = (await response.text()).slice(0, 300)
      expect([attempt.who, attempt.call, response.status()]).toEqual([attempt.who, attempt.call, attempt.status])
      rows.push([attempt.who, attempt.call, `${attempt.method} ${attempt.path}`, String(response.status()), body])
    }
    // The refused writes wrote nothing.
    expect(((await (await sarah.get(`/api/tickets/${ticket.id}/actions`)).json()) as unknown[]).length).toBe(2)

    await renderTable(
      page,
      'Actions Taken requests, made with a real session for each role',
      'Each row is one request sent straight to the API, with no screen involved, and the response it received.',
      ['Who', 'Tried to', 'Request', 'Status', 'Response body'],
      rows,
    )
    await capture(page, 'actions-taken', 'forbidden-api')
  })

  test('a failed load leaves the rest of the Ticket standing', async ({ page }) => {
    await loginAs(page, 'staff')
    await page.route(`**/api/tickets/${ticket.id}/actions`, (route) => route.abort())
    await page.goto(`/staff/tickets/${ticket.id}`)
    await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
    await expect(actionsArea(page).getByRole('alert').getByText('Unable to load the Actions Taken')).toBeVisible()
    await expect(workflowOf(page)).toBeVisible()
    await actionsArea(page).screenshot({ path: shot('actions-taken', 'failure') })
  })
})

test.describe('Part 7: the Ticket workflow', () => {
  let ticket: Made

  test.beforeAll(async ({ request }) => {
    ticket = await ownedInProgress(request, 'Shared printer on floor 2 prints blank pages')
  })

  /** Records an Action Taken through the screen. */
  async function addAction(page: Page, fields: { description: string; result: string; followUp?: string }) {
    await actionsArea(page).getByRole('button', { name: 'Add Action Taken' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add Action Taken' })
    await dialog.getByLabel(/^Action Description/).fill(fields.description)
    await dialog.getByLabel(/^Result/).fill(fields.result)
    if (fields.followUp) {
      await dialog.getByLabel('Follow-Up Required?').check()
      await dialog.getByLabel(/^Follow-up Note/).fill(fields.followUp)
    }
    await dialog.getByRole('button', { name: 'Save Action Taken' }).click()
    await expect(dialog).toBeHidden()
  }

  test('the resolution gate, from closed to open', async ({ page }) => {
    await loginAs(page, 'staff')
    await page.goto(`/staff/tickets/${ticket.id}`)
    const workflow = workflowOf(page)
    const move = workflow.getByLabel('Move to')
    const resolved = move.getByRole('option', { name: /^Resolved/ })

    // The moves on offer from In Progress, and the one that is held back.
    await expect(move.getByRole('option')).toHaveText([
      'Choose a status…',
      'Waiting for Requester',
      'Resolved (not available yet)',
      'Cancelled',
    ])
    await workflow.screenshot({ path: shot('ticket-workflow', 'permitted-transitions') })

    await expect(resolved).toBeDisabled()
    await expect(workflow.getByTestId('blocked-RESOLVED')).toContainText('Record an Action Taken before resolving this Ticket')
    await workflow.screenshot({ path: shot('ticket-workflow', 'gate-no-actions') })

    await addAction(page, {
      description: 'Replaced the toner cartridge.',
      result: 'Prints, but pages are faint.',
      followUp: 'Run the drum cleaning cycle.',
    })
    await expect(workflow.getByTestId('blocked-RESOLVED')).toContainText('The latest Action Taken still requires follow-up')
    await workflow.screenshot({ path: shot('ticket-workflow', 'gate-follow-up') })

    await addAction(page, {
      description: 'Ran the drum cleaning cycle twice.',
      result: 'Pages print at full density. Nothing further needed.',
    })
    await expect(workflow.getByTestId('blocked-RESOLVED')).toHaveCount(0)
    await expect(resolved).toBeEnabled()
    await move.selectOption('RESOLVED')
    await workflow.screenshot({ path: shot('ticket-workflow', 'gate-cleared') })

    await workflow.getByRole('button', { name: 'Change status' }).click()
    await expect(page.locator('.ttk-detail__card').first().locator('.ttk-badge', { hasText: 'Resolved' })).toBeVisible()
    await expect(move.getByRole('option')).toHaveText(['Choose a status…', 'Closed', 'Reopened'])
    await capture(page, 'ticket-workflow', 'resolved')

    // BR-08: the record is frozen now that the Ticket is finished.
    const area = actionsArea(page)
    await expect(area.getByRole('button', { name: 'Add Action Taken' })).toHaveCount(0)
    await expect(area.getByText('This Ticket is Resolved. Reopen it to record more work.')).toBeVisible()
    await area.screenshot({ path: shot('actions-taken', 'frozen-resolved') })
  })

  test('a change made from an out-of-date screen is refused', async ({ page, request }) => {
    const second = await ownedInProgress(request, 'Wi-Fi drops in the library basement')
    await loginAs(page, 'staff')
    await page.goto(`/staff/tickets/${second.id}`)
    const workflow = workflowOf(page)
    await expect(workflow.getByLabel('IT Priority')).toHaveValue('MEDIUM')

    // While this screen sits open, a colleague raises the priority.
    const marcus = await cookieFor(request, ACCOUNTS.colleague.email)
    expect((await workflowChange(request, second.id, 'it-priority', { itPriority: 'URGENT' }, marcus)).status()).toBe(200)

    await workflow.getByLabel('Move to').selectOption('WAITING_FOR_REQUESTER')
    await workflow.getByRole('button', { name: 'Change status' }).click()
    await expect(workflow.getByRole('alert')).toContainText('This Ticket was changed by someone else. Reload it and try again.')
    await expect(workflow.getByLabel('IT Priority')).toHaveValue('URGENT')
    await workflow.screenshot({ path: shot('ticket-workflow', 'stale-ticket') })
  })

  test('the Requester has no workflow control on their own Ticket', async ({ page }) => {
    await loginAs(page, 'requester')
    await page.goto(`/tickets/${ticket.id}`)
    await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
    await expect(actionsArea(page).getByText('2 Actions Taken', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Workflow' })).toHaveCount(0)
    await expect(page.getByLabel('Move to')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Change status|Assign|Unassign/ })).toHaveCount(0)
    await capture(page, 'ticket-workflow', 'requester-no-control')
  })
})

test.describe('Part 8: what Labs 1 to 3 built, still working', () => {
  let ticket: Made

  test.beforeAll(async ({ request }) => {
    runCleanup()
    const requester = await firstRequester(request)
    ticket = (await createTicket(request, requester, {
      summary: 'Projector in LX-204 shows no signal from the lectern',
      description: `The lectern PC is on and the cable is seated, but the projector reports no signal. Reported during the ${FIXTURE_MARKER}.`,
      requestedPriority: 'MEDIUM',
    })) as Made
    await attachFile(request, ticket.id, requester, 'projector-no-signal.png')
    const sarah = await cookieFor(request, ACCOUNTS.staff.email)
    for (const [body, visibility] of [
      ['Is the input on the lectern panel set to HDMI 1?', 'PUBLIC'],
      ['Same fault as last month. The HDMI switch behind the lectern needs replacing.', 'INTERNAL'],
    ]) {
      await request.post(`${API}/api/tickets/${ticket.id}/comments`, { headers: { Cookie: sarah }, data: { body, visibility } })
    }
    await request.post(`${API}/api/tickets/${ticket.id}/comments`, {
      headers: { Cookie: await cookieFor(request, requester.email) },
      data: { body: 'It is on HDMI 1. Still no signal.' },
    })
  })

  test('signing in', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await capture(page, 'regression', 'login')
    await signInThroughForm(page, ACCOUNTS.requester.email, DEV_PASSWORD)
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('the Requester’s screens: My Tickets, Ticket Detail, attachments and comments', async ({ page }) => {
    await loginAs(page, 'requester')
    await page.goto('/tickets')
    await expect(page.getByRole('table').getByRole('link', { name: ticket.ticketNumber })).toBeVisible()
    await capture(page, 'regression', 'my-tickets')

    await page.getByRole('table').getByRole('link', { name: ticket.ticketNumber }).click()
    await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
    await expect(page.getByText('It is on HDMI 1. Still no signal.')).toBeVisible()
    await capture(page, 'regression', 'ticket-detail')

    const attachments = page.locator('.ttk-attachments')
    await expect(attachments.getByText('projector-no-signal.png')).toBeVisible()
    await attachments.screenshot({ path: shot('regression', 'attachments') })

    const comments = page.locator('.ttk-thread')
    await expect(comments.getByText('Is the input on the lectern panel set to HDMI 1?')).toBeVisible()
    // BR-04: the Internal Note is not on the Requester's screen.
    await expect(page.getByText(/HDMI switch behind the lectern/)).toHaveCount(0)
    await comments.screenshot({ path: shot('regression', 'public-comments') })
  })

  test('the staff screens: the queue and the Internal Notes', async ({ page }) => {
    await loginAs(page, 'staff')
    await page.goto('/staff/tickets')
    await expect(page.getByRole('table').getByRole('link', { name: ticket.ticketNumber })).toBeVisible()
    await capture(page, 'regression', 'staff-queue')

    await page.goto(`/staff/tickets/${ticket.id}`)
    const notes = page.locator('.ttk-thread--internal')
    await expect(notes.getByText(/HDMI switch behind the lectern/)).toBeVisible()
    await notes.screenshot({ path: shot('regression', 'internal-notes') })
  })

  test('the Administrator’s screens: User Management and System Status', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/users')
    await expect(page.getByRole('table').getByText(ACCOUNTS.staff.name)).toBeVisible()
    await capture(page, 'regression', 'user-management')

    await page.goto('/system-status')
    await expect(page.getByText('Online', { exact: true })).toBeVisible()
    await expect(page.getByText(/Submit Request/)).toHaveCount(0)
    await capture(page, 'regression', 'system-status')
  })
})
