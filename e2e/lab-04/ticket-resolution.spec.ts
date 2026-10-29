import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  ACCOUNTS,
  API,
  FIXTURE_MARKER,
  actionsArea,
  cookieFor,
  createTicket,
  firstRequester,
  loginAs,
  workflowChange,
} from './helpers'

// E2E-03, E2E-04 (Lab 4 AC-19, AC-20, AC-21, AC-25, AC-27, AC-28, AC-29).
//
// The resolution gate as a person meets it: Resolved is on offer but not
// available, the screen says why in the server's words, and it becomes
// available when the work that was missing is recorded. Then the same Ticket
// open on two screens, one of them out of date.

const NO_ACTION = 'Record an Action Taken before resolving this Ticket'
const FOLLOW_UP = 'The latest Action Taken still requires follow-up'

const workflowOf = (page: Page) => page.getByRole('region', { name: 'Workflow' })
const resolvedOption = (page: Page) =>
  workflowOf(page).getByLabel('Move to').getByRole('option', { name: /^Resolved/ })

/** Records an Action Taken through the screen. */
async function addAction(
  page: Page,
  fields: { description: string; result: string; followUp?: string },
) {
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

/** A Ticket of Peter's, owned by Sarah and In Progress, with no work on it. */
async function ownedTicketInProgress(request: Parameters<typeof createTicket>[0], summary: string) {
  const requester = await firstRequester(request)
  const ticket = (await createTicket(request, requester, {
    summary,
    description: `Reported during the ${FIXTURE_MARKER}.`,
    requestedPriority: 'MEDIUM',
  })) as { id: number; ticketNumber: string }

  const sarah = await cookieFor(request, ACCOUNTS.staff.email)
  const me = (await (await request.get(`${API}/api/auth/me`, { headers: { Cookie: sarah } })).json()).user
  expect((await workflowChange(request, ticket.id, 'owner', { ownerId: me.id }, sarah)).status()).toBe(200)
  expect(
    (await workflowChange(request, ticket.id, 'status', { currentStatus: 'IN_PROGRESS' }, sarah)).status(),
  ).toBe(200)
  return ticket
}

test('E2E-03: Resolved is not available until the work that was missing is recorded', async ({
  page,
  request,
}) => {
  const ticket = await ownedTicketInProgress(request, 'Projector in LX-204 will not power on')
  await loginAs(page, 'staff')
  await page.goto(`/staff/tickets/${ticket.id}`)
  const workflow = workflowOf(page)

  // AC-19, AC-27: on offer, disabled, with the reason in words beside it.
  await expect(resolvedOption(page)).toBeDisabled()
  await expect(resolvedOption(page)).toHaveText('Resolved (not available yet)')
  await expect(workflow.getByTestId('blocked-RESOLVED')).toContainText(`Resolved: ${NO_ACTION}.`)
  // The moves that do not depend on recorded work are untouched.
  await expect(workflow.getByLabel('Move to').getByRole('option', { name: 'Cancelled' })).toBeEnabled()

  // The screen is only a guide. Asked directly, the server says the same.
  const direct = await workflowChange(page.request, ticket.id, 'status', { currentStatus: 'RESOLVED' })
  expect(direct.status()).toBe(409)
  expect(await direct.json()).toEqual({ error: NO_ACTION, code: 'RESOLUTION_GATE' })

  // The link in the reason leads to where it is fixed.
  await workflow.getByTestId('blocked-RESOLVED').getByRole('link', { name: 'Go to Actions Taken' }).click()
  await expect(actionsArea(page)).toBeInViewport()

  // AC-20: work that asks for follow-up changes the reason, not the answer.
  await addAction(page, {
    description: 'Replaced the lamp.',
    result: 'Powers on, but the lamp-hours counter did not reset.',
    followUp: 'Reset the counter with the service remote.',
  })
  await expect(workflow.getByTestId('blocked-RESOLVED')).toContainText(`Resolved: ${FOLLOW_UP}.`)
  await expect(resolvedOption(page)).toBeDisabled()

  // The follow-up is closed by recording what was done about it.
  await addAction(page, {
    description: 'Reset the lamp-hours counter with the service remote.',
    result: 'Counter reads 0. Nothing further needed.',
  })
  // AC-27: available now, with no page reload in between.
  await expect(workflow.getByTestId('blocked-RESOLVED')).toHaveCount(0)
  await expect(resolvedOption(page)).toBeEnabled()
  await expect(resolvedOption(page)).toHaveText('Resolved')

  // AC-21, AC-28.
  await workflow.getByLabel('Move to').selectOption('RESOLVED')
  await workflow.getByRole('button', { name: 'Change status' }).click()

  const summary = page.locator('.ttk-detail__card').first()
  await expect(summary.locator('.ttk-badge', { hasText: 'Resolved' })).toBeVisible()
  await expect(summary.locator('.ttk-badge', { hasText: 'In Progress' })).toHaveCount(0)
  await expect(workflow.getByLabel('Move to').getByRole('option')).toHaveText([
    'Choose a status…',
    'Closed',
    'Reopened',
  ])
  // The record is frozen now that the Ticket is finished (BR-08).
  await expect(actionsArea(page).getByRole('button', { name: 'Add Action Taken' })).toHaveCount(0)
  await expect(actionsArea(page).getByText('This Ticket is Resolved. Reopen it to record more work.')).toBeVisible()

  const stored = (await (await page.request.get(`${API}/api/staff/tickets/${ticket.id}`)).json()) as {
    currentStatus: string
    resolvedAt: string | null
  }
  expect(stored.currentStatus).toBe('RESOLVED')
  expect(stored.resolvedAt).not.toBeNull()
})

test('E2E-04: a change made from an out-of-date screen is refused, and the screen catches up', async ({
  page,
  browser,
  request,
}) => {
  const ticket = await ownedTicketInProgress(request, 'Shared printer on floor 2 prints blank pages')

  // Sarah has the Ticket open.
  await loginAs(page, 'staff')
  await page.goto(`/staff/tickets/${ticket.id}`)
  const sarah = workflowOf(page)
  await expect(sarah.getByLabel('IT Priority')).toHaveValue('MEDIUM')

  // So does Marcus, in a browser of his own, and he changes the priority.
  const other = await browser.newContext()
  const marcusPage = await other.newPage()
  await loginAs(marcusPage, 'colleague')
  await marcusPage.goto(`/staff/tickets/${ticket.id}`)
  const marcus = workflowOf(marcusPage)
  await marcus.getByLabel('IT Priority').selectOption('URGENT')
  await expect(marcus.getByText('Currently')).toContainText('Urgent')

  // Sarah's screen still shows Medium. She moves the Ticket on from it.
  await expect(sarah.getByLabel('IT Priority')).toHaveValue('MEDIUM')
  await sarah.getByLabel('Move to').selectOption('WAITING_FOR_REQUESTER')
  await sarah.getByRole('button', { name: 'Change status' }).click()

  // AC-25, AC-29: refused, said beside the control, and the Ticket reloaded.
  await expect(sarah.getByRole('alert')).toContainText(
    'This Ticket was changed by someone else. Reload it and try again.',
  )
  await expect(sarah.getByLabel('IT Priority')).toHaveValue('URGENT')
  // Her change was not applied on top of his.
  const afterRefusal = (await (await page.request.get(`${API}/api/staff/tickets/${ticket.id}`)).json()) as {
    currentStatus: string
    itPriority: string
  }
  expect(afterRefusal).toMatchObject({ currentStatus: 'IN_PROGRESS', itPriority: 'URGENT' })

  // Now that her screen is current, the same change goes through.
  await sarah.getByLabel('Move to').selectOption('WAITING_FOR_REQUESTER')
  await sarah.getByRole('button', { name: 'Change status' }).click()
  await expect(page.locator('.ttk-detail__card').first().locator('.ttk-badge', { hasText: 'Waiting for Requester' })).toBeVisible()

  await other.close()
})
