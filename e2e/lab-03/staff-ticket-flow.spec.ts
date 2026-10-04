import { expect, test } from '@playwright/test'
import {
  ACCOUNTS,
  API,
  FIXTURE_MARKER,
  cookieFor,
  createTicket,
  firstRequester,
  loginAs,
} from './helpers'

// E2E-03, E2E-04 (AC-18, AC-20, AC-27, AC-30, AC-32, AC-33, AC-34).
//
// One Ticket, followed from both sides. The steps run in order on purpose: the
// second half is only meaningful because of what the first half did.

test.describe.configure({ mode: 'serial' })

const NOTE = 'Same fault as the batch reported last week. Vendor case 8841.'
const STAFF_COMMENT = 'We have a replacement charger for you at the service desk.'
const REQUESTER_COMMENT = 'Collected it, and it charges now. Thank you.'

let ticket: { id: number; ticketNumber: string }

test.describe('one Ticket, from the queue to resolved', () => {
  test.beforeAll(async ({ request }) => {
    const requester = await firstRequester(request)
    ticket = await createTicket(request, requester, {
      summary: 'Laptop will not charge from either port',
      description: `Stopped charging this morning. Tried two chargers. Reported during the ${FIXTURE_MARKER}.`,
      requestedPriority: 'MEDIUM',
    })
  })

  test('E2E-03: IT Staff find it, claim it, set its priority, move it and write on it', async ({
    page,
  }) => {
    await loginAs(page, 'staff')
    await page.goto('/staff/tickets')

    // Found through the queue, not by typing its URL.
    await page.getByLabel('Search').fill(ticket.ticketNumber)
    await page.getByRole('button', { name: 'Search' }).click()
    const row = page.getByRole('table').getByRole('row').filter({ hasText: ticket.ticketNumber })
    await expect(row).toContainText('Unassigned')
    await row.getByRole('link', { name: ticket.ticketNumber }).click()
    await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()

    const workflow = page.getByRole('region', { name: 'Workflow' })

    // AC-33: nobody owns it yet, so Resolved is not available.
    await expect(
      workflow.getByLabel('Move to').getByRole('option', { name: /Resolved/ }),
    ).toHaveCount(0)

    // AC-27.
    await workflow.getByRole('button', { name: 'Claim' }).click()
    await expect(page.getByTestId('owner-current')).toHaveText('Sarah Chen (you)')

    // AC-30: IT Priority moves, Requested Priority stays what was asked for.
    await workflow.getByLabel('IT Priority').selectOption('URGENT')
    await expect(workflow.getByLabel('IT Priority')).toHaveValue('URGENT')
    await expect(page.getByTestId('requested-priority')).toHaveText('Medium')

    await workflow.getByLabel('Move to').selectOption('IN_PROGRESS')
    await workflow.getByRole('button', { name: 'Change status' }).click()
    await expect(workflow.getByLabel('Move to').getByRole('option')).toHaveText([
      'Choose a status…',
      'Waiting for Requester',
      'Resolved',
      'Cancelled',
    ])

    // AC-31: Closed is not reachable from In Progress, in the UI or the API.
    const illegal = await page.request.patch(`${API}/api/staff/tickets/${ticket.id}/status`, {
      data: { currentStatus: 'CLOSED' },
    })
    expect(illegal.status()).toBe(409)

    await page.getByLabel('Add a public comment').fill(STAFF_COMMENT)
    await page.getByRole('button', { name: 'Post comment' }).click()
    await page.getByLabel('Add an internal note').fill(NOTE)
    await page.getByRole('button', { name: 'Add internal note' }).click()
    await expect(page.getByText(NOTE)).toBeVisible()

    // Back to the same search, where the queue now shows the new owner.
    await page.getByRole('link', { name: /Back to Ticket Queue/ }).click()
    await expect(page).toHaveURL(new RegExp(`search=${ticket.ticketNumber}`))
    const updated = page.getByRole('table').getByRole('row').filter({ hasText: ticket.ticketNumber })
    await expect(updated).toContainText('Sarah Chen')
    await expect(updated).toContainText('Urgent')
    await expect(updated).toContainText('In Progress')
  })

  test('E2E-04: the Requester sees the comment, never the note, and says it looks fixed', async ({
    page,
    request,
  }) => {
    await loginAs(page, 'requester')

    // Their own list, which still carries the Tickets from before Lab 3.
    await page.goto('/tickets')
    await expect(page.getByRole('table').getByRole('link').first()).toBeVisible()

    await page.goto(`/tickets/${ticket.id}`)
    await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
    await expect(page.getByText(STAFF_COMMENT)).toBeVisible()

    // AC-34: not on the page, and not in what the page was sent.
    await expect(page.getByText(NOTE)).toHaveCount(0)
    await expect(page.getByText(/internal/i)).toHaveCount(0)
    const sent = await request.get(`${API}/api/tickets/${ticket.id}/comments`, {
      headers: { Cookie: await cookieFor(request, ACCOUNTS.requester.email) },
    })
    expect(JSON.stringify(await sent.json())).not.toContain('8841')

    // No control here changes the status (BR-05).
    await expect(page.getByLabel('Move to')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Change status' })).toHaveCount(0)

    // AC-18.
    await page.getByLabel('Add a comment').fill(REQUESTER_COMMENT)
    await page.getByRole('button', { name: 'Post comment' }).click()
    await expect(page.getByText(REQUESTER_COMMENT)).toBeVisible()

    // AC-20: a signal, not a status change.
    await page.getByRole('button', { name: 'Problem appears resolved' }).click()
    await page.getByRole('button', { name: 'Yes, it appears resolved' }).click()
    await expect(page.getByText(/You reported that this problem appears resolved/)).toBeVisible()
    await expect(page.getByText('In Progress').first()).toBeVisible()
  })

  test('IT Staff see the signal and the reply, and resolve the Ticket (AC-32)', async ({ page }) => {
    await loginAs(page, 'staff')
    await page.goto(`/staff/tickets/${ticket.id}`)

    const workflow = page.getByRole('region', { name: 'Workflow' })
    await expect(workflow.getByText(/The Requester reported this appears resolved/)).toBeVisible()
    await expect(page.getByText(REQUESTER_COMMENT)).toBeVisible()

    await workflow.getByLabel('Move to').selectOption('RESOLVED')
    await workflow.getByRole('button', { name: 'Change status' }).click()
    await expect(workflow.getByLabel('Move to').getByRole('option')).toHaveText([
      'Choose a status…',
      'Closed',
      'Reopened',
    ])
    // A Resolved Ticket keeps its owner.
    await expect(workflow.getByRole('button', { name: 'Unassign' })).toBeDisabled()
  })

  test('the Requester sees it Resolved, with nothing left to signal', async ({ page }) => {
    await loginAs(page, 'requester')
    await page.goto(`/tickets/${ticket.id}`)

    // The badge carries a tick before the word, so match the badge, not the text alone.
    await expect(page.locator('.ttk-badge', { hasText: 'Resolved' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Problem appears resolved' })).toHaveCount(0)
    // Said in the past tense now: IT Staff have acted.
    await expect(page.getByText(/IT Staff will confirm and close/)).toHaveCount(0)
  })
})
