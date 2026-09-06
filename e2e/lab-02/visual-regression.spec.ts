import { expect, test } from '@playwright/test'
import {
  VIEWPORTS,
  attachFile,
  createTicket,
  expectNoHorizontalScroll,
  firstRequester,
  secondRequester,
  selectRequester,
  shot,
} from './helpers'
import type { ViewportName } from './helpers'

/**
 * RESP-01 and RESP-02 (AC-25, ui-spec.md §7-§11).
 *
 * Every capture is paired with an assertion. A spec that only screenshots
 * proves nothing — it passes just as happily when the layout is broken, and
 * the images then become evidence of a bug rather than of conformance.
 */

test.describe('RESP-01 (AC-25): the three screens at three breakpoints', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS) as [
    ViewportName,
    { width: number; height: number },
  ][]) {
    test(`create-ticket, my-tickets and ticket-detail at ${name}`, async ({ page, request }) => {
      await page.setViewportSize(viewport)
      const requester = await firstRequester(request)
      const ticket = await createTicket(request, requester.id)
      await attachFile(request, ticket.id, requester.id)
      await selectRequester(page, requester)

      // --- Create Ticket -------------------------------------------------
      await page.goto('/tickets/new')
      await expect(page.getByLabel(/^Category/)).toBeVisible()
      await expectNoHorizontalScroll(page, viewport.width)
      await page.screenshot({ path: shot('create-ticket', name), fullPage: true })

      // --- My Tickets ----------------------------------------------------
      await page.goto('/tickets')
      await expect(page.getByRole('heading', { name: 'My Tickets' })).toBeVisible()
      await expectNoHorizontalScroll(page, viewport.width)

      // ui-spec.md §6.3: table on desktop and tablet, cards on mobile. Both
      // markups are in the DOM and one is switched off, so asserting each
      // confirms the swap happened rather than both rendering at once.
      const table = page.locator('.ttk-my-tickets__table')
      const cards = page.locator('.ttk-my-tickets__cards')
      const visibleLayout = name === 'mobile' ? cards : table
      if (name === 'mobile') {
        await expect(table).toBeHidden()
        await expect(cards).toBeVisible()
      } else {
        await expect(table).toBeVisible()
        await expect(cards).toBeHidden()
      }

      // Scoped to the layout that is actually showing: the hidden copy holds
      // the same text, so an unscoped match would assert against the wrong one.
      await expect(visibleLayout.getByText(ticket.ticketNumber)).toBeVisible()
      await page.screenshot({ path: shot('my-tickets', name), fullPage: true })

      // --- Ticket Detail -------------------------------------------------
      await page.goto(`/tickets/${ticket.id}`)
      await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
      await expect(page.getByRole('region', { name: /Attachments/i })).toBeVisible()
      await expectNoHorizontalScroll(page, viewport.width)
      await page.screenshot({ path: shot('ticket-detail', name), fullPage: true })
    })
  }
})

test.describe('RESP-01: sorting stays reachable where the table is hidden', () => {
  test('mobile exposes a sort control outside the table (FR-07)', async ({ page, request }) => {
    await page.setViewportSize(VIEWPORTS.mobile)
    const requester = await firstRequester(request)
    await createTicket(request, requester.id)
    await selectRequester(page, requester)

    await page.goto('/tickets')
    await expect(page.locator('.ttk-my-tickets__table')).toBeHidden()
    // The table's sort headers went with it, so this control is the only way
    // to sort on a phone.
    await expect(page.getByLabel('Sort by')).toBeVisible()
  })
})

test.describe('RESP-02 (ui-spec §7): badge consistency across screens', () => {
  test('the same Ticket shows the same badge text and class on both screens', async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)
    const ticket = await createTicket(request, requester.id, { requestedPriority: 'HIGH' })
    await selectRequester(page, requester)

    await page.goto('/tickets')
    const row = page.locator('tbody tr', { hasText: ticket.ticketNumber })
    const listPriority = row.locator('.ttk-badge').first()
    const listBadges = {
      text: (await listPriority.innerText()).trim(),
      className: await listPriority.getAttribute('class'),
    }

    await page.goto(`/tickets/${ticket.id}`)
    const detailPriority = page.locator('.ttk-detail__field', { hasText: 'Requested Priority' })
      .locator('.ttk-badge')
    const detailBadges = {
      text: (await detailPriority.innerText()).trim(),
      className: await detailPriority.getAttribute('class'),
    }

    // Same value must render identically on both screens — a drift here is
    // exactly what a shared component is supposed to prevent.
    expect(detailBadges).toEqual(listBadges)
    expect(listBadges.text).toBe('High')
  })

  test('badges always carry their label, never colour alone', async ({ page, request }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)
    await createTicket(request, requester.id)
    await selectRequester(page, requester)

    await page.goto('/tickets')
    const badges = page.locator('.ttk-badge')
    const count = await badges.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i += 1) {
      expect((await badges.nth(i).innerText()).trim()).not.toBe('')
    }
  })
})

test.describe('ui-spec §10: field states are distinguishable', () => {
  test('read-only fields differ from editable ones, and are not disabled', async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)
    await selectRequester(page, requester)

    await page.goto('/tickets/new')
    // Role-scoped: the header's "Change Requester" link also carries an
    // aria-label containing "Requester".
    const readOnly = page.getByRole('textbox', { name: 'Requester', exact: true })
    const editable = page.getByRole('textbox', { name: /^Summary/ })

    await expect(readOnly).toBeVisible()
    await expect(readOnly).toHaveJSProperty('readOnly', true)
    // Read-only and disabled are distinct states (§3); disabled would also
    // drop the field out of the tab order AC-26 requires.
    await expect(readOnly).toBeEnabled()

    const readOnlyBg = await readOnly.evaluate((el) => getComputedStyle(el).backgroundColor)
    const editableBg = await editable.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(readOnlyBg, 'read-only and editable fields look identical').not.toBe(editableBg)
  })

  test('validation messages sit under their own field, not only at the top', async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)
    await selectRequester(page, requester)

    await page.goto('/tickets/new')
    await page.getByRole('button', { name: 'Create Ticket' }).click()

    const summary = page.getByLabel(/^Summary/)
    const message = page.getByText('Summary is required.')
    await expect(message).toBeVisible()

    const field = await summary.boundingBox()
    const error = await message.boundingBox()
    // Directly below the control it belongs to (§3), not floating elsewhere.
    expect(error!.y).toBeGreaterThan(field!.y)
    expect(Math.abs(error!.x - field!.x)).toBeLessThan(40)

    await page.screenshot({ path: shot('create-ticket', 'validation-failure'), fullPage: true })
  })
})

test.describe('ui-spec §11: the named state captures', () => {
  test('create-ticket: initial and invalid-attachment', async ({ page, request }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)
    await selectRequester(page, requester)

    await page.goto('/tickets/new')
    await expect(page.getByLabel(/^Category/)).toBeVisible()
    await page.screenshot({ path: shot('create-ticket', 'initial'), fullPage: true })

    await page.getByLabel('Add files').setInputFiles({
      name: 'payload.exe',
      mimeType: 'application/x-msdownload',
      buffer: Buffer.from('MZ'),
    })
    await expect(page.getByText(/is not a permitted type/)).toBeVisible()
    await page.screenshot({ path: shot('create-ticket', 'invalid-attachment'), fullPage: true })
  })

  test('create-ticket: success shows the generated Ticket Number', async ({ page, request }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)
    await selectRequester(page, requester)

    await page.goto('/tickets/new')
    await page.getByLabel(/^Category/).selectOption({ index: 1 })
    await page.getByLabel(/^Related System/).selectOption({ index: 1 })
    await page.getByLabel(/^Requested Priority/).selectOption('MEDIUM')
    await page.getByLabel(/^Summary/).fill('Wi-Fi drops in the library basement')
    await page
      .getByLabel(/^Description/)
      .fill('Signal disappears entirely near the study rooms, on two different laptops.')
    await page.getByRole('button', { name: 'Create Ticket' }).click()

    // AC-01: the number comes from the backend and is shown on success.
    const number = page.getByText(/^TKT-\d{4}-\d{6}$/)
    await expect(number).toBeVisible()
    await page.screenshot({ path: shot('create-ticket', 'success'), fullPage: true })
  })

  test('create-ticket: api-failure keeps the entered values (AC-07)', async ({ page, request }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)
    await selectRequester(page, requester)

    await page.goto('/tickets/new')
    await page.getByLabel(/^Category/).selectOption({ index: 1 })
    await page.getByLabel(/^Related System/).selectOption({ index: 1 })
    await page.getByLabel(/^Requested Priority/).selectOption('HIGH')
    await page.getByLabel(/^Summary/).fill('Values must survive a failed submit')
    await page
      .getByLabel(/^Description/)
      .fill('This submission is made to fail so the retained-values rule can be seen.')

    // Simulate the backend being unreachable at the moment of submit.
    await page.route('**/api/tickets', (route) => route.abort('failed'))
    await page.getByRole('button', { name: 'Create Ticket' }).click()

    await expect(page.getByRole('alert')).toContainText(/Unable to reach the TokTickIT API/i)
    await expect(page.getByLabel(/^Summary/)).toHaveValue('Values must survive a failed submit')
    await page.screenshot({ path: shot('create-ticket', 'api-failure'), fullPage: true })
  })

  test('my-tickets: empty and no-results are visibly different (BR-28)', async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const withTickets = await firstRequester(request)
    const withNone = await secondRequester(request)
    await createTicket(request, withTickets.id)

    // Empty: an account that owns nothing, with no filters applied.
    await selectRequester(page, withNone)
    await page.goto('/tickets')
    await expect(page.getByText(/haven't created any tickets yet/i)).toBeVisible()
    // The toolbar is absent here: offering filters over nothing implies data
    // exists somewhere to filter.
    await expect(page.getByRole('search')).toHaveCount(0)
    await page.screenshot({ path: shot('my-tickets', 'empty'), fullPage: true })

    // No-results: an account that owns Tickets, filtered to none.
    await page.context().clearCookies()
    await selectRequester(page, withTickets)
    await page.goto('/tickets')
    await page.getByLabel(/^Search/).fill('no-ticket-matches-this-string')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByText(/No tickets match your filters/i)).toBeVisible()
    // Distinct copy, and the toolbar stays so the filters can be cleared.
    await expect(page.getByRole('search')).toBeVisible()
    await page.screenshot({ path: shot('my-tickets', 'no-results'), fullPage: true })
  })

  test('my-tickets: failure state offers a retry', async ({ page, request }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)
    await selectRequester(page, requester)

    await page.route('**/api/tickets?*', (route) => route.abort('failed'))
    await page.goto('/tickets')

    await expect(page.getByRole('alert')).toContainText(/Unable to load your Tickets/i)
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    await page.screenshot({ path: shot('my-tickets', 'failure'), fullPage: true })
  })

  test('ticket-detail: active and removed attachment states', async ({ page, request }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)
    const ticket = await createTicket(request, requester.id)
    await attachFile(request, ticket.id, requester.id, 'active-evidence.png')
    await attachFile(request, ticket.id, requester.id, 'to-be-removed.png')
    await selectRequester(page, requester)

    await page.goto(`/tickets/${ticket.id}`)
    await expect(page.getByText('active-evidence.png')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Download' }).first()).toBeVisible()
    await page.screenshot({ path: shot('ticket-detail', 'attachments-active'), fullPage: true })

    // Remove the second one, with a reason (AC-22).
    const removable = page.locator('.ttk-attachments__row', { hasText: 'to-be-removed.png' })
    await removable.getByRole('button', { name: 'Remove' }).click()
    await page.getByLabel(/Reason for removal/).fill('Uploaded the wrong screenshot')
    await page.getByRole('button', { name: 'Confirm removal' }).click()

    // AC-20/BR-24: still listed, with its reason, and no Download.
    await expect(removable.getByText('Removed')).toBeVisible()
    await expect(removable.getByText(/Uploaded the wrong screenshot/)).toBeVisible()
    await expect(removable.getByRole('link', { name: 'Download' })).toHaveCount(0)
    await page.screenshot({ path: shot('ticket-detail', 'attachments-removed'), fullPage: true })
  })
})

test.describe('ui-spec §10: button hierarchy and touch targets', () => {
  test('the four button variants are visually distinct (§4)', async ({ page, request }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)
    const ticket = await createTicket(request, requester.id)
    await attachFile(request, ticket.id, requester.id)
    await selectRequester(page, requester)

    await page.goto(`/tickets/${ticket.id}`)

    // Ticket Detail carries tertiary (Download) and destructive (Remove); the
    // form below has primary and secondary. Comparing computed colour rather
    // than class names catches two variants that merely *say* they differ.
    const styleOf = (selector: string) =>
      page.locator(selector).first().evaluate((el) => {
        const s = getComputedStyle(el)
        return `${s.backgroundColor}|${s.color}|${s.borderColor}`
      })

    const tertiary = await styleOf('.ttk-btn--tertiary')
    const destructive = await styleOf('.ttk-btn--destructive')
    expect(destructive, 'tertiary and destructive look identical').not.toBe(tertiary)

    await page.goto('/tickets/new')
    const primary = await styleOf('.ttk-btn--primary')
    const secondary = await styleOf('.ttk-btn--secondary')
    expect(secondary, 'primary and secondary look identical').not.toBe(primary)
    expect(new Set([primary, secondary, tertiary, destructive]).size).toBe(4)
  })

  test('filters, pagination and attachment controls stay usable on mobile', async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORTS.mobile)
    const requester = await firstRequester(request)
    const ticket = await createTicket(request, requester.id)
    await attachFile(request, ticket.id, requester.id)
    await selectRequester(page, requester)

    await page.goto('/tickets')
    for (const control of ['Search', 'Category', 'Requested Priority', 'Sort by']) {
      await expect(page.getByLabel(control, { exact: true })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Clear Filters' })).toBeVisible()

    await page.goto(`/tickets/${ticket.id}`)
    const remove = page.getByRole('button', { name: 'Remove' })
    await expect(remove).toBeVisible()
    await expect(page.getByRole('link', { name: 'Download' })).toBeVisible()

    // ui-spec.md §8: touch targets stay usable, not merely present.
    const box = await remove.boundingBox()
    expect(box!.height, 'Remove is below a comfortable touch target').toBeGreaterThanOrEqual(40)
  })
})
