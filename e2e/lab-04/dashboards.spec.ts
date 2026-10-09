import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  ACCOUNTS,
  API,
  DEV_PASSWORD,
  FIXTURE_MARKER,
  VIEWPORTS,
  actionsArea,
  cookieFor,
  createTicket,
  firstRequester,
  expectNoHorizontalScroll,
  loginAs,
  recordAction,
  requesterWithoutTickets,
  secondRequester,
  signInThroughForm,
  workflowChange,
} from './helpers'

// E2E-05, E2E-06, E2E-07 (Lab 4 AC-02, AC-30 to AC-33, AC-35, AC-37, AC-40,
// AC-45).
//
// What a count on a dashboard promises is that following it shows that many
// Tickets. So each card is read, followed, and compared with the total the
// list states, in the browser, against the real API and database. Nothing
// here asserts a particular number: the database holds whatever the seed and
// the other specs left in it.

const card = (page: Page, key: string) => page.getByTestId(`metric-${key}`)
const valueOf = async (locator: Locator) => Number((await locator.textContent())?.trim())

/** The total the open list states. A list with nothing in it states none. */
async function listTotal(page: Page): Promise<number> {
  const empty = page.getByRole('heading', { name: /^No (T|t)ickets match/ })
  const total = page.getByTestId('list-total')
  await expect(total.or(empty)).toBeVisible()
  if (await empty.isVisible()) return 0
  return Number((await total.textContent())?.match(/\d+/)?.[0])
}

/** Follows a card and returns what it said and what the list says. */
async function follow(page: Page, key: string) {
  const shown = await valueOf(page.getByTestId(`metric-${key}-value`))
  await card(page, key).click()
  return { shown, total: await listTotal(page) }
}

test('E2E-05: IT Staff land on a Dashboard whose counts open the Tickets they count', async ({
  page,
  request,
}) => {
  // Something for every card: an unassigned Ticket, and one of Sarah's that
  // is Urgent, In Progress and has work recorded on it today.
  const requester = await firstRequester(request)
  const make = (summary: string) =>
    createTicket(request, requester, {
      summary,
      description: `Reported during the ${FIXTURE_MARKER}.`,
    }) as Promise<{ id: number; ticketNumber: string }>
  await make('Dashboard spec: nobody has picked this up')
  const mine = await make('Dashboard spec: Sarah is working on this')

  const sarah = await cookieFor(request, ACCOUNTS.staff.email)
  const me = (await (await request.get(`${API}/api/auth/me`, { headers: { Cookie: sarah } })).json()).user
  for (const [what, data] of [
    ['owner', { ownerId: me.id }],
    ['it-priority', { itPriority: 'URGENT' }],
    ['status', { currentStatus: 'IN_PROGRESS' }],
  ] as const) {
    expect((await workflowChange(request, mine.id, what, data, sarah)).status()).toBe(200)
  }
  await recordAction(request, mine.id, sarah, {
    description: 'Dashboard spec: swapped the power supply.',
  })

  // AC-40: signing in arrives here, with Dashboard marked in the navigation.
  await signInThroughForm(page, ACCOUNTS.staff.email, DEV_PASSWORD)
  await expect(page).toHaveURL(/\/staff\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Welcome back, Sarah' })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)

  // AC-33, AC-37: each card, followed, with its filter shown in the controls.
  const cards = [
    { key: 'unassigned', control: 'Owner', value: 'unassigned' },
    { key: 'myTickets', control: 'Owner', value: 'me' },
    { key: 'urgent', control: 'IT Priority', value: 'URGENT' },
  ]
  for (const { key, control, value } of cards) {
    await page.goto('/staff/dashboard')
    const { shown, total } = await follow(page, key)

    expect(shown, `${key} shows at least the Ticket this spec made`).toBeGreaterThanOrEqual(1)
    expect(total, `${key}: the queue's total equals the card`).toBe(shown)
    await expect(page.getByLabel('Status', { exact: true })).toHaveValue('ACTIVE')
    await expect(page.getByLabel(control, { exact: true })).toHaveValue(value)
  }

  // My Actions Today counts, and is not a link.
  await page.goto('/staff/dashboard')
  expect(await valueOf(page.getByTestId('metric-myActionsToday-value'))).toBeGreaterThanOrEqual(1)
  await expect(card(page, 'myActionsToday').getByRole('link')).toHaveCount(0)

  // The eight statuses add up to the queue, and a row opens the queue for it.
  const byStatus = page.getByTestId('by-status')
  await expect(byStatus.getByRole('link')).toHaveCount(8)
  const counts = await byStatus.locator('.ttk-dash-status__count').allTextContents()
  const sum = counts.reduce((total, count) => total + Number(count), 0)
  const inProgress = Number(
    await byStatus.getByRole('link', { name: /^In Progress,/ }).locator('.ttk-dash-status__count').textContent(),
  )

  await byStatus.getByRole('link', { name: /^In Progress,/ }).click()
  await expect(page).toHaveURL(/\/staff\/tickets\?status=IN_PROGRESS$/)
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('IN_PROGRESS')
  expect(await listTotal(page)).toBe(inProgress)

  await page.goto('/staff/tickets')
  expect(await listTotal(page)).toBe(sum)

  // A recent action opens its Ticket at the Actions Taken area.
  await page.goto('/staff/dashboard')
  const action = page.getByTestId('list-my-actions').getByRole('link').first()
  await expect(action).toContainText('Dashboard spec: swapped the power supply.')
  await expect(action).toContainText(mine.ticketNumber)
  await action.click()
  await expect(page).toHaveURL(new RegExp(`/staff/tickets/${mine.id}#actions-taken$`))
  await expect(actionsArea(page)).toBeInViewport()
  await expect(actionsArea(page)).toContainText('Dashboard spec: swapped the power supply.')
  // A Ticket lives under the queue, so that is the item marked now.
  await expect(nav.getByRole('link', { name: 'Ticket Queue' })).toHaveAttribute('aria-current', 'page')

  // A recently updated row opens the Ticket itself.
  await page.goto('/staff/dashboard')
  await page.getByTestId('list-recently-updated').getByRole('link', { name: new RegExp(mine.ticketNumber) }).click()
  await expect(page).toHaveURL(new RegExp(`/staff/tickets/${mine.id}$`))
})

test('E2E-06: a Requester lands on a Dashboard of their own Tickets and nobody else’s', async ({
  page,
  request,
}) => {
  const peter = await firstRequester(request)
  const other = await secondRequester(request)
  const describe = { description: `Reported during the ${FIXTURE_MARKER}.` }
  const waiting = (await createTicket(request, peter, {
    summary: 'Dashboard spec: Peter is asked a question',
    ...describe,
  })) as { id: number; ticketNumber: string }
  const theirs = (await createTicket(request, other, {
    summary: 'Dashboard spec: somebody else entirely',
    ...describe,
  })) as { id: number; ticketNumber: string }

  const sarah = await cookieFor(request, ACCOUNTS.staff.email)
  expect(
    (await workflowChange(request, waiting.id, 'status', { currentStatus: 'OPEN' }, sarah)).status(),
  ).toBe(200)
  expect(
    (
      await workflowChange(request, waiting.id, 'status', { currentStatus: 'WAITING_FOR_REQUESTER' }, sarah)
    ).status(),
  ).toBe(200)

  await signInThroughForm(page, peter.email, DEV_PASSWORD)
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: `Welcome, ${peter.name.split(' ')[0]}` })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav.locator('[aria-current="page"]')).toHaveText('Dashboard')

  // AC-02: the other Requester's Ticket is nowhere on the screen.
  await expect(card(page, 'openTickets')).toBeVisible()
  await expect(page.getByRole('main')).not.toContainText(theirs.ticketNumber)
  await expect(page.getByRole('main')).not.toContainText('somebody else entirely')

  // The Ticket waiting on Peter is under Needs your attention.
  const attention = page.getByTestId('list-needs-attention')
  await expect(attention.getByRole('link', { name: new RegExp(waiting.ticketNumber) })).toBeVisible()

  // AC-30, AC-37: each card, followed.
  const cards = [
    { key: 'openTickets', status: 'ACTIVE', atLeast: 1 },
    { key: 'waitingForYou', status: 'WAITING_FOR_REQUESTER', atLeast: 1 },
    { key: 'resolved', status: 'RESOLVED', atLeast: 0 },
    { key: 'closed', status: 'CLOSED', atLeast: 0 },
  ]
  for (const { key, status, atLeast } of cards) {
    await page.goto('/dashboard')
    const { shown, total } = await follow(page, key)

    expect(shown).toBeGreaterThanOrEqual(atLeast)
    expect(total, `${key}: My Tickets' total equals the card`).toBe(shown)
    await expect(page).toHaveURL(new RegExp(`/tickets\\?status=${status}$`))
    await expect(page.getByLabel('Status', { exact: true })).toHaveValue(status)
    await expect(page.getByRole('main')).not.toContainText(theirs.ticketNumber)
  }

  // A row opens the Ticket, which lives under My Tickets.
  await page.goto('/dashboard')
  await attention.getByRole('link', { name: new RegExp(waiting.ticketNumber) }).click()
  await expect(page).toHaveURL(new RegExp(`/tickets/${waiting.id}$`))
  await expect(nav.locator('[aria-current="page"]')).toHaveText('My Tickets')

  // Reload and Back keep the filtered list (ui-spec §5).
  await page.goto('/dashboard')
  await card(page, 'waitingForYou').click()
  await page.reload()
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('WAITING_FOR_REQUESTER')
  await page.getByRole('table').getByRole('link', { name: waiting.ticketNumber }).click()
  await page.goBack()
  await expect(page).toHaveURL(/\/tickets\?status=WAITING_FOR_REQUESTER$/)
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('WAITING_FOR_REQUESTER')
})

test('E2E-06: a Requester with no Tickets sees zeros and one empty state', async ({ page, request }) => {
  const empty = await requesterWithoutTickets(request)

  await signInThroughForm(page, empty.email, DEV_PASSWORD)
  await expect(page).toHaveURL(/\/dashboard$/)

  // AC-31: a result, not a failure.
  for (const key of ['openTickets', 'waitingForYou', 'resolved', 'closed']) {
    await expect(page.getByTestId(`metric-${key}-value`)).toHaveText('0')
  }
  await expect(page.getByRole('heading', { name: 'You have not created any Tickets yet' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByTestId('list-recently-updated')).toHaveCount(0)

  await page.getByRole('main').getByRole('button', { name: 'Create Ticket' }).last().click()
  await expect(page).toHaveURL(/\/tickets\/new$/)
})

test('E2E-07: the Administrator’s extras, and routes that are not yours', async ({ page, request }) => {
  // AC-35: the user counts are on the Administrator's screen and match the
  // list they link to.
  await loginAs(page, 'admin')
  await page.goto('/')
  await expect(page).toHaveURL(/\/staff\/dashboard$/)
  const accounts = page.getByTestId('user-accounts')
  await expect(accounts).toBeVisible()

  const admin = await cookieFor(request, ACCOUNTS.admin.email)
  const users = (await (
    await request.get(`${API}/api/users`, { headers: { Cookie: admin } })
  ).json()) as { isActive: boolean }[]
  await expect(page.getByTestId('users-active')).toHaveText(String(users.filter((u) => u.isActive).length))
  await expect(page.getByTestId('users-inactive')).toHaveText(String(users.filter((u) => !u.isActive).length))

  await accounts.getByRole('link').click()
  await expect(page).toHaveURL(/\/admin\/users$/)

  // AC-45: System Status is theirs, and has nothing left in it that does nothing.
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'System Status' }).click()
  await expect(page).toHaveURL(/\/system-status$/)
  await expect(page.getByText('Online', { exact: true })).toBeVisible()
  await expect(page.getByText('TokTickIT API is answering')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hardware' })).toBeVisible()
  await expect(page.getByText(/Submit Request/)).toHaveCount(0)

  // IT Staff see neither.
  await page.context().clearCookies()
  await loginAs(page, 'staff')
  await page.goto('/staff/dashboard')
  await expect(page.getByTestId('by-status')).toBeVisible()
  await expect(page.getByTestId('user-accounts')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'System Status' })).toHaveCount(0)

  await page.goto('/system-status')
  await expect(page.getByRole('alert')).toContainText('do not have permission')
  await expect(page.getByRole('heading', { name: 'System Status' })).toHaveCount(0)

  // AC-32: staff typing the Requester's address.
  await page.goto('/dashboard')
  await expect(page.getByRole('alert')).toContainText('do not have permission')
  await page.getByRole('alert').getByRole('link').click()
  await expect(page).toHaveURL(/\/staff\/dashboard$/)

  // AC-32: a Requester typing the staff address gets the reason and a way
  // back, and the API refuses them on its own account.
  await page.context().clearCookies()
  await loginAs(page, 'requester')
  await page.goto('/staff/dashboard')
  await expect(page.getByRole('alert')).toContainText('do not have permission')
  await expect(page.getByTestId('by-status')).toHaveCount(0)
  await page.getByRole('alert').getByRole('link').click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByTestId('metric-openTickets')).toBeVisible()

  const peter = await cookieFor(request, ACCOUNTS.requester.email)
  const refused = await request.get(`${API}/api/dashboard/staff`, { headers: { Cookie: peter } })
  expect(refused.status()).toBe(403)
  expect(await refused.json()).toEqual({ error: 'You do not have permission to perform this action' })
})

test('the header holds every role’s navigation on one line at every width', async ({ page }) => {
  // Lab 4 added Dashboard for everyone and System Status for the Administrator.
  // At tablet width three or four labels do not fit beside the identity
  // controls, so those roles' items move into the menu there. IT Staff have
  // two, which fit, and theirs stay in the header.
  const NAV = {
    requester: ['Dashboard', 'My Tickets', 'Create Ticket'],
    staff: ['Dashboard', 'Ticket Queue'],
    admin: ['Dashboard', 'Ticket Queue', 'User Management', 'System Status'],
  } as const

  for (const role of ['requester', 'staff', 'admin'] as const) {
    await page.context().clearCookies()
    await loginAs(page, role)

    for (const [name, size] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(size)
      await page.goto(ACCOUNTS[role].landing)
      const header = page.getByRole('banner')
      const nav = header.getByRole('navigation', { name: 'Primary' })
      const toggle = header.getByRole('button', { name: /navigation menu/ })
      const inMenu = name === 'mobile' || (name === 'tablet' && role !== 'staff')
      const where = `${role} at ${name}`

      expect((await header.boundingBox())!.height, `${where}: header height`).toBe(64)
      await expectNoHorizontalScroll(page, size.width)

      if (inMenu) {
        await expect(toggle, where).toBeVisible()
        await expect(nav, where).toBeHidden()
        await toggle.click()
      } else {
        await expect(toggle, where).toBeHidden()
      }

      await expect(nav.getByRole('link'), where).toHaveText([...NAV[role]])
      for (const link of await nav.getByRole('link').all()) {
        await expect(link, where).toBeVisible()
        // One line of text: a wrapped label is twice this.
        expect((await link.boundingBox())!.height, `${where}: ${await link.textContent()}`).toBeLessThan(50)
      }
      // The role badge is whole wherever the name is shown beside it.
      if (name !== 'mobile') {
        const badge = header.locator('.ttk-shell__role')
        expect(
          await badge.evaluate((el) => el.scrollWidth <= el.clientWidth),
          `${where}: role badge not cut off`,
        ).toBe(true)
      }
    }
  }
})
