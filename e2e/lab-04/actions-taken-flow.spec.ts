import { expect, test } from '@playwright/test'
import {
  ACCOUNTS,
  API,
  FIXTURE_MARKER,
  actionsArea,
  cookieFor,
  createTicket,
  firstRequester,
  loginAs,
  sessionAs,
  workflowChange,
} from './helpers'

// E2E-01, E2E-02 (Lab 4 AC-01, AC-03, AC-04, AC-10, AC-11, AC-42).
//
// One Ticket, the work recorded on it by two people who do not own it, then
// the same Ticket as its Requester sees it. The steps run in order on purpose:
// the second half is only meaningful because of what the first half did.

test.describe.configure({ mode: 'serial' })

const FIRST = {
  description: 'Checked the charger and both ports with a known good laptop.',
  result: 'The charger is dead. The ports are fine.',
  followUp: 'Hand over the replacement charger when the Requester comes by.',
  attachment: 'Photo of the charger label: charger-label.jpg',
}
const SECOND = {
  description: 'Issued a replacement charger from stock.',
  result: 'Laptop charges at full rate.',
}
const CORRECTED_RESULT = 'The charger is dead (no output on the meter). The ports are fine.'
const NOTE = 'Third dead charger from this batch. Vendor case 9120.'

let ticket: { id: number; ticketNumber: string }

test.describe('work recorded on one Ticket, and what its Requester sees', () => {
  test.beforeAll(async ({ request }) => {
    const requester = await firstRequester(request)
    ticket = await createTicket(request, requester, {
      summary: 'Laptop will not charge at my desk',
      description: `Stopped charging this morning. Reported during the ${FIXTURE_MARKER}.`,
      requestedPriority: 'MEDIUM',
    })

    // Owned by Marcus throughout, so that neither person who records work
    // below is its owner (BR-02), and with an Internal Note on it, so the
    // Requester's half can show that the note stays out of sight.
    const marcus = await cookieFor(request, ACCOUNTS.colleague.email)
    const assignable = await request.get(`${API}/api/staff/assignable-users`, {
      headers: { Cookie: marcus },
    })
    const me = ((await assignable.json()) as { id: number; name: string }[]).find(
      (user) => user.name === ACCOUNTS.colleague.name,
    )
    const owned = await workflowChange(request, ticket.id, 'owner', { ownerId: me!.id }, marcus)
    expect(owned.status(), await owned.text()).toBe(200)
    const noted = await request.post(`${API}/api/tickets/${ticket.id}/comments`, {
      headers: { Cookie: marcus },
      data: { body: NOTE, visibility: 'INTERNAL' },
    })
    expect(noted.status(), await noted.text()).toBe(201)
  })

  test('E2E-01: two people who do not own the Ticket record work on it, and one corrects the other', async ({
    page,
  }) => {
    // --- Sarah, who is not the owner -----------------------------------
    await loginAs(page, 'staff')
    await page.goto(`/staff/tickets/${ticket.id}`)
    await expect(page.getByTestId('owner-current')).toHaveText('Marcus Reed')

    const area = actionsArea(page)
    await expect(area.getByText('No Actions Taken have been recorded for this Ticket yet.')).toBeVisible()
    await expect(area.getByText('Work recorded on this Ticket. Visible to the Requester.')).toBeVisible()

    await area.getByRole('button', { name: 'Add Action Taken' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add Action Taken' })
    await expect(dialog.getByText('Sarah Chen (you)')).toBeVisible()
    // The time offered is kept as it is: this Ticket was created moments ago,
    // and the form's own default has to be acceptable on it (BR-05).
    await expect(dialog.getByLabel(/^Action Date\/Time/)).not.toHaveValue('')

    // AC-07: follow-up ticked with no note is refused on the note's own field.
    await dialog.getByLabel(/^Action Description/).fill(FIRST.description)
    await dialog.getByLabel(/^Result/).fill(FIRST.result)
    await dialog.getByLabel('Follow-Up Required?').check()
    await dialog.getByRole('button', { name: 'Save Action Taken' }).click()
    await expect(dialog.getByText('Say what follow-up is needed.')).toBeVisible()
    await expect(dialog.getByLabel(/^Follow-up Note/)).toBeFocused()

    await dialog.getByLabel(/^Follow-up Note/).fill(FIRST.followUp)
    await dialog.getByLabel(/^Attachment Notes/).fill(FIRST.attachment)
    // AC-42: a double click on Save must not record the work twice.
    await dialog.getByRole('button', { name: 'Save Action Taken' }).dblclick()

    await expect(dialog).toBeHidden()
    await expect(area.getByText('1 Action Taken', { exact: true })).toBeVisible()
    const firstRow = area.getByRole('row').filter({ hasText: FIRST.description })
    await expect(firstRow).toContainText('Sarah Chen')
    await expect(firstRow).toContainText('Follow-up required')
    // Recording work did not make her the owner.
    await expect(page.getByTestId('owner-current')).toHaveText('Marcus Reed')

    // --- Alex, an Administrator, also not the owner ---------------------
    await loginAs(page, 'admin')
    await page.goto(`/staff/tickets/${ticket.id}`)
    await area.getByRole('button', { name: 'Add Action Taken' }).click()
    const second = page.getByRole('dialog', { name: 'Add Action Taken' })
    await expect(second.getByText('Alex Morgan (you)')).toBeVisible()
    await second.getByLabel(/^Action Description/).fill(SECOND.description)
    await second.getByLabel(/^Result/).fill(SECOND.result)
    await second.getByRole('button', { name: 'Save Action Taken' }).click()

    await expect(second).toBeHidden()
    await expect(area.getByText('2 Actions Taken', { exact: true })).toBeVisible()
    await expect(area.getByRole('row').filter({ hasText: SECOND.description })).toContainText('Alex Morgan')
    await expect(area.getByRole('row').filter({ hasText: SECOND.description })).toContainText('No follow-up')

    // AC-11: Alex corrects what Sarah wrote. It stays Sarah's.
    await firstRow.getByRole('button', { name: /^View the Action Taken by Sarah Chen/ }).click()
    const view = page.getByRole('dialog', { name: 'Action Taken', exact: true })
    await expect(view.getByRole('textbox')).toHaveCount(0)
    await view.getByRole('button', { name: 'Edit' }).click()

    const edit = page.getByRole('dialog', { name: 'Edit Action Taken' })
    await expect(edit.getByText('Sarah Chen. Cannot be changed.')).toBeVisible()
    await expect(edit.getByLabel(/^Follow-up Note/)).toHaveValue(FIRST.followUp)
    await edit.getByLabel(/^Result/).fill(CORRECTED_RESULT)
    await edit.getByRole('button', { name: 'Save changes' }).click()

    await expect(edit).toBeHidden()
    const corrected = area.getByRole('row').filter({ hasText: FIRST.description })
    await expect(corrected).toContainText(CORRECTED_RESULT)
    await expect(corrected).toContainText('Sarah Chen')
    await expect(corrected).toContainText('Edited by Alex Morgan')
    await expect(page.getByTestId('owner-current')).toHaveText('Marcus Reed')

    // What the database holds, read back through the API: two rows, each
    // under the name of the person who was signed in, one of them edited.
    const stored = await page.request.get(`${API}/api/tickets/${ticket.id}/actions`)
    const actions = (await stored.json()) as {
      description: string
      result: string
      performedBy: { name: string }
      editedBy: { name: string } | null
      version: number
    }[]
    expect(actions).toHaveLength(2)
    const byDescription = (text: string) => actions.find((action) => action.description === text)!
    expect(byDescription(FIRST.description)).toMatchObject({
      result: CORRECTED_RESULT,
      performedBy: { name: 'Sarah Chen' },
      editedBy: { name: 'Alex Morgan' },
      version: 2,
    })
    expect(byDescription(SECOND.description)).toMatchObject({
      performedBy: { name: 'Alex Morgan' },
      editedBy: null,
      version: 1,
    })
  })

  test('E2E-02: the Requester sees all of it, can change none of it, and never sees the note', async ({
    page,
    playwright,
  }) => {
    await loginAs(page, 'requester')
    await page.goto(`/tickets/${ticket.id}`)
    await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()

    const area = actionsArea(page)
    await expect(area.getByText('2 Actions Taken', { exact: true })).toBeVisible()
    await expect(area.getByText('Work IT Staff have recorded on your Ticket.')).toBeVisible()
    await expect(area.getByRole('button', { name: 'Add Action Taken' })).toHaveCount(0)

    // AC-03: every field of the action, in the view, and no way to edit.
    await area
      .getByRole('row')
      .filter({ hasText: FIRST.description })
      .getByRole('button', { name: /^View the Action Taken by Sarah Chen/ })
      .click()
    const view = page.getByRole('dialog', { name: 'Action Taken', exact: true })
    for (const text of [
      FIRST.description,
      CORRECTED_RESULT,
      'Sarah Chen',
      'Follow-up required',
      FIRST.followUp,
      FIRST.attachment,
      'Alex Morgan',
    ]) {
      await expect(view.getByText(text, { exact: false }).first()).toBeVisible()
    }
    for (const label of [
      'Action Date/Time',
      'Action Description',
      'Result',
      'Performed by',
      'Follow-Up Required?',
      'Follow-up Note',
      'Attachment Notes',
    ]) {
      await expect(view.getByText(label, { exact: true })).toBeVisible()
    }
    await expect(view.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await expect(view.getByRole('textbox')).toHaveCount(0)
    await view.getByRole('button', { name: 'Close' }).click()

    // The Internal Note on this Ticket is nowhere on the page.
    await expect(page.getByText(NOTE)).toHaveCount(0)
    await expect(page.getByText(/internal note/i)).toHaveCount(0)

    // AC-04: and the API refuses what the screen does not offer.
    const peter = await sessionAs(playwright, ACCOUNTS.requester.email)
    const listed = await peter.get(`/api/tickets/${ticket.id}/actions`)
    const [anAction] = (await listed.json()) as { id: number }[]
    const created = await peter.post(`/api/tickets/${ticket.id}/actions`, {
      data: {
        requestKey: `e2e-requester-${Date.now()}`,
        actionAt: new Date().toISOString(),
        description: 'Written by the Requester',
        result: 'Should never be saved',
        followUpRequired: false,
      },
    })
    const edited = await peter.patch(`/api/tickets/${ticket.id}/actions/${anAction.id}`, {
      data: { expectedVersion: 1, description: 'Changed by the Requester' },
    })
    expect(created.status()).toBe(403)
    expect(edited.status()).toBe(403)
    expect(((await (await peter.get(`/api/tickets/${ticket.id}/actions`)).json()) as unknown[]).length).toBe(2)
    await peter.dispose()
  })
})
