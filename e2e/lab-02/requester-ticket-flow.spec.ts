import { expect, test } from '@playwright/test'
import {
  FIXTURE_MARKER,
  VIEWPORTS,
  createTicket,
  firstRequester,
  secondRequester,
  signInThroughSelector,
} from './helpers'

/**
 * E2E-01 and E2E-02 (AC-01, AC-03, AC-11, AC-17, AC-18, AC-20).
 *
 * These drive the app the way a person does — through the selector, the form
 * and the attachment controls — rather than seeding state and asserting on the
 * result. That is the difference between these and the visual specs: those
 * take the localStorage shortcut because the selector is not what they test,
 * while a flow that skips the selector never proves the selector works.
 */

const DESCRIPTION = `The projector in LX-204 shows no power light. Tried a second cable and socket. ${FIXTURE_MARKER}.`

test.describe('E2E-01: the full Requester journey', () => {
  test('select Requester, create, find, open, attach, remove', async ({ page, request }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)

    // --- 1. Sign in through the selector (AC-02) ------------------------
    await signInThroughSelector(page, requester)

    // --- 2. Create a Ticket (AC-01) -------------------------------------
    await page.getByRole('button', { name: 'Create Ticket' }).first().click()
    await expect(page).toHaveURL(/\/tickets\/new$/)

    // The Requester carries over from the selection, read-only (AC-17).
    const requesterField = page.getByRole('textbox', { name: 'Requester', exact: true })
    await expect(requesterField).toHaveValue(requester.name)
    await expect(requesterField).toHaveJSProperty('readOnly', true)

    const summary = `Projector will not power on ${Date.now()}`
    await page.getByLabel(/^Category/).selectOption({ index: 1 })
    await page.getByLabel(/^Related System/).selectOption({ index: 1 })
    await page.getByLabel(/^Requested Priority/).selectOption('HIGH')
    await page.getByLabel(/^Summary/).fill(summary)
    await page.getByLabel(/^Description/).fill(DESCRIPTION)
    await page.getByRole('button', { name: 'Create Ticket' }).click()

    // AC-01: the official number comes back from the backend.
    const numberText = page.getByText(/^TKT-\d{4}-\d{6}$/)
    await expect(numberText).toBeVisible()
    const ticketNumber = (await numberText.innerText()).trim()

    // --- 3. Find it in My Tickets (AC-11) -------------------------------
    // The success card offers View Ticket / Create Another, so the way to the
    // list is the primary nav — which is what a person would use.
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'My Tickets' })
      .click()
    await expect(page).toHaveURL(/\/tickets$/)

    // Search for it rather than trusting it to be on page 1 — the list is
    // paginated and other runs may have added rows.
    await page.getByLabel(/^Search/).fill(ticketNumber)
    await page.getByRole('button', { name: 'Apply' }).click()

    const row = page.locator('tbody tr', { hasText: ticketNumber })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(summary)
    await expect(row).toContainText('High')

    // --- 4. Open Ticket Detail (AC-17) ----------------------------------
    await row.getByRole('link', { name: ticketNumber }).click()
    await expect(page.getByRole('heading', { name: ticketNumber })).toBeVisible()
    await expect(page.getByText(summary)).toBeVisible()

    // The header card is read-only: no editable control anywhere in it.
    const header = page.locator('.ttk-detail__card')
    expect(await header.locator('input, select, textarea').count()).toBe(0)

    // --- 5. Add an attachment (AC-18) -----------------------------------
    await page.getByLabel('Add an attachment').setInputFiles({
      name: 'projector-photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
        'hex',
      ),
    })

    const attachmentRow = page.locator('.ttk-attachments__row', {
      hasText: 'projector-photo.png',
    })
    // AC-18: appears without a reload.
    await expect(attachmentRow).toBeVisible()
    await expect(attachmentRow.getByRole('link', { name: 'Download' })).toBeVisible()

    // It survives a real reload too — i.e. it was actually persisted, not just
    // added to local state.
    await page.reload()
    await expect(
      page.locator('.ttk-attachments__row', { hasText: 'projector-photo.png' }),
    ).toBeVisible()

    // --- 6. Soft-remove it (AC-20, AC-22) -------------------------------
    const persisted = page.locator('.ttk-attachments__row', {
      hasText: 'projector-photo.png',
    })
    await persisted.getByRole('button', { name: 'Remove' }).click()

    // AC-22: a removal with no reason is refused.
    await page.getByRole('button', { name: 'Confirm removal' }).click()
    await expect(page.getByText(/at least 3 characters/i)).toBeVisible()
    await expect(persisted.getByText('Removed')).toHaveCount(0)

    await page.getByLabel(/Reason for removal/).fill('Photo was out of focus')
    await page.getByRole('button', { name: 'Confirm removal' }).click()

    // AC-20/BR-24: still listed with its reason, and Download is gone.
    await expect(persisted.getByText('Removed')).toBeVisible()
    await expect(persisted.getByText(/Photo was out of focus/)).toBeVisible()
    await expect(persisted.getByRole('link', { name: 'Download' })).toHaveCount(0)

    // BR-23: the removal is persisted, not just reflected in local state.
    await page.reload()
    const afterReload = page.locator('.ttk-attachments__row', {
      hasText: 'projector-photo.png',
    })
    await expect(afterReload.getByText('Removed')).toBeVisible()
    await expect(afterReload.getByRole('link', { name: 'Download' })).toHaveCount(0)
  })
})

test.describe('E2E-02 (AC-03): one Requester cannot reach another’s Ticket', () => {
  test('direct navigation to a Ticket owned by someone else is refused', async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const owner = await firstRequester(request)
    const other = await secondRequester(request)

    // Owner's Ticket, created out of band so this spec tests access, not
    // creation.
    const ticket = await createTicket(request, owner.id, {
      summary: `Owned by ${owner.name} ${Date.now()}`,
    })

    // The other Requester gets a Ticket of their own. Without one they land in
    // the Empty state, which hides the toolbar by design (BR-28) — and
    // "B sees their own but not A's" is a stronger claim than "B sees nothing".
    const theirs = await createTicket(request, other.id, {
      summary: `Owned by ${other.name} ${Date.now()}`,
    })

    await signInThroughSelector(page, other)

    // Their own Ticket is there.
    await expect(page.locator('tbody tr', { hasText: theirs.ticketNumber })).toHaveCount(1)

    // The owner's is not, even searched for by number (AC-11).
    await page.getByLabel(/^Search/).fill(ticket.ticketNumber)
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByText(/No tickets match your filters/i)).toBeVisible()

    // Nor by typing the URL directly (AC-03/BR-08).
    await page.goto(`/tickets/${ticket.id}`)
    await expect(page.getByRole('alert')).toContainText(/Ticket not found/i)

    // The refusal must not leak what it is refusing.
    const body = await page.locator('body').innerText()
    expect(body).not.toContain(ticket.ticketNumber)
    expect(body).not.toContain(ticket.summary)
  })

  test('the owner can still reach it, so the block is ownership and not breakage', async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const owner = await firstRequester(request)
    const ticket = await createTicket(request, owner.id, {
      summary: `Reachable by owner ${Date.now()}`,
    })

    await signInThroughSelector(page, owner)
    await page.goto(`/tickets/${ticket.id}`)

    // Same URL, different Requester, opposite outcome — which is what makes
    // the test above meaningful rather than just a broken page.
    await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
  })

  test('switching Requester swaps the visible Tickets (AC-12)', async ({ page, request }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const owner = await firstRequester(request)
    const other = await secondRequester(request)
    const ticket = await createTicket(request, owner.id, {
      summary: `Switch check ${Date.now()}`,
    })

    // Both need a Ticket: the switch target would otherwise land in the Empty
    // state, where the toolbar is deliberately absent.
    await createTicket(request, other.id, { summary: `Theirs ${Date.now()}` })

    await signInThroughSelector(page, owner)
    await page.getByLabel(/^Search/).fill(ticket.ticketNumber)
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('tbody tr', { hasText: ticket.ticketNumber })).toHaveCount(1)

    // Change Requester, and the previous one's Ticket goes with them.
    await page.getByRole('link', { name: /Change Requester/i }).click()
    await page.getByLabel('Development Requester').selectOption(String(other.id))
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByText(other.name).first()).toBeVisible()
    await expect(page.locator('tbody tr', { hasText: ticket.ticketNumber })).toHaveCount(0)
    // The old search term must not survive the switch either (BR-05).
    await expect(page.getByLabel(/^Search/)).toHaveValue('')
  })
})
