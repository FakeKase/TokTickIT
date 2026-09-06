import { expect, test } from '@playwright/test'
import {
  API,
  FIXTURE_MARKER,
  VIEWPORTS,
  attachFile,
  createTicket,
  firstRequester,
  secondRequester,
  selectRequester,
  shot,
} from './helpers'

/**
 * Screenshots for the submission PDF (handout §14, Parts 5-8).
 *
 * Separate from visual-regression.spec.ts, which exists to catch layout
 * defects. These exist to evidence specific behaviours a marker is asked to
 * look for, so each one is named after the thing it must show.
 *
 * Every capture is preceded by an assertion that the state is actually on
 * screen. A screenshot taken before the state arrives is worse than no
 * screenshot: it looks like evidence and shows the wrong moment.
 */

const DESCRIPTION = `Reported during the ${FIXTURE_MARKER}, with enough body text for the Detail screen to render realistically.`

test.describe('Part 6 — Development Requester Selection', () => {
  test('screen, dropdown, selected-user display and Change Requester action', async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)

    // --- The Selection screen itself ------------------------------------
    await page.goto('/tickets')
    await expect(page).toHaveURL(/\/select-requester$/)
    await expect(
      page.getByText(/Select a Development Requester to test requester-specific/i),
    ).toBeVisible()
    await expect(page.getByText(/not a login screen/i)).toBeVisible()
    await page.screenshot({ path: shot('dev-requester-selection', 'screen'), fullPage: true })

    // --- The Requester options, loaded and selectable --------------------
    // A native <select> popup is painted by the browser's own UI layer rather
    // than by the page, so page.screenshot() cannot photograph it expanded on
    // any browser. Focusing it only draws a focus ring, which is why the
    // earlier capture was 0.017% different from 'screen' above and showed the
    // "Choose a Requester…" placeholder rather than any Requester at all.
    // The option list is proven by assertion; the capture carries the part a
    // screenshot honestly can — a real Requester chosen and displayed.
    const dropdown = page.getByLabel('Development Requester')
    const options = await dropdown.locator('option').allInnerTexts()
    // BR-04: only active Requesters are offered. The inactive seed row must
    // not appear among them.
    expect(options.length).toBeGreaterThan(1)
    expect(options.join('|')).not.toContain('David Kim')
    await dropdown.selectOption(String(requester.id))
    await expect(dropdown).toHaveValue(String(requester.id))
    // The chosen Requester's name must be on screen, so the file cannot drift
    // from what its name claims.
    await expect(dropdown.locator('option:checked')).toContainText(requester.name)
    await page.screenshot({
      path: shot('dev-requester-selection', 'requester-options-loaded'),
      fullPage: true,
    })

    // --- Continue, and the selected user showing in the shell ------------
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page).toHaveURL(/\/tickets$/)
    const header = page.locator('.ttk-shell__requester')
    await expect(header).toContainText(requester.name)
    await page.screenshot({
      path: shot('dev-requester-selection', 'selected-user-display'),
      fullPage: true,
    })

    // --- The Change Requester action, actually taken ---------------------
    // Captured after the click, on the screen it returns to, so the file
    // shows the action's effect rather than the button sitting unused.
    await page.getByRole('link', { name: /Change Requester/i }).click()
    await expect(page).toHaveURL(/\/select-requester$/)
    await expect(page.getByLabel('Development Requester')).toBeVisible()
    await page.screenshot({
      path: shot('dev-requester-selection', 'change-requester-action'),
      fullPage: true,
    })
  })

  test('loading and failure states', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop)

    // --- Loading: hold the response open long enough to capture ----------
    await page.route('**/api/requesters', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      await route.continue()
    })
    await page.goto('/select-requester')
    await expect(page.getByText(/Loading Development Requesters/i)).toBeVisible()
    await page.screenshot({ path: shot('dev-requester-selection', 'loading'), fullPage: true })
    await page.unroute('**/api/requesters')

    // --- Failure: AC-24, a safe message and a Retry ----------------------
    await page.route('**/api/requesters', (route) => route.abort('failed'))
    await page.goto('/select-requester')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText(/Unable to load Development Requesters/i)
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    // The safe message must not leak the underlying failure.
    await expect(alert).not.toContainText(/fetch|network|ECONN/i)
    await page.screenshot({ path: shot('dev-requester-selection', 'failure'), fullPage: true })
  })
})

test.describe('Part 6 — Create Ticket submitting state', () => {
  test('submit is busy and disabled while the request is in flight (AC-06)', async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)
    await selectRequester(page, requester)

    // Hold the create request open so the busy state can be photographed.
    await page.route('**/api/tickets', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await new Promise((resolve) => setTimeout(resolve, 4000))
      await route.continue()
    })

    await page.goto('/tickets/new')
    await page.getByLabel(/^Category/).selectOption({ index: 1 })
    await page.getByLabel(/^Related System/).selectOption({ index: 1 })
    await page.getByLabel(/^Requested Priority/).selectOption('MEDIUM')
    await page.getByLabel(/^Summary/).fill('Submitting state evidence capture')
    await page.getByLabel(/^Description/).fill(DESCRIPTION)
    await page.getByRole('button', { name: 'Create Ticket' }).click()

    // BR-17: disabled for the whole flight, so repeat clicks cannot duplicate.
    const busy = page.getByRole('button', { name: /Creating Ticket/i })
    await expect(busy).toBeVisible()
    await expect(busy).toBeDisabled()
    await page.screenshot({ path: shot('create-ticket', 'submitting'), fullPage: true })
  })
})

test.describe('Part 7 — My Tickets', () => {
  test('requester A list, then B, showing A’s Tickets are gone (AC-11, AC-12)', async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const a = await firstRequester(request)
    const b = await secondRequester(request)

    const ownedByA = await createTicket(request, a.id, {
      summary: `Belongs to ${a.name} ${Date.now()}`,
    })
    const ownedByB = await createTicket(request, b.id, {
      summary: `Belongs to ${b.name} ${Date.now()}`,
    })

    // --- A's list --------------------------------------------------------
    await selectRequester(page, a)
    await page.goto('/tickets')
    await page.getByLabel(/^Search/).fill(ownedByA.ticketNumber)
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('tbody tr', { hasText: ownedByA.ticketNumber })).toHaveCount(1)
    await page.screenshot({ path: shot('my-tickets', 'requester-a-list'), fullPage: true })

    // --- Switch to B, and A's Ticket is gone -----------------------------
    await page.getByRole('link', { name: /Change Requester/i }).click()
    await page.getByLabel('Development Requester').selectOption(String(b.id))
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.locator('.ttk-shell__requester')).toContainText(b.name)

    await page.getByLabel(/^Search/).fill(ownedByA.ticketNumber)
    await page.getByRole('button', { name: 'Apply' }).click()
    // The same search that found it for A finds nothing for B.
    await expect(page.getByText(/No tickets match your filters/i)).toBeVisible()
    await page.screenshot({ path: shot('my-tickets', 'requester-b-list'), fullPage: true })

    // And B does see their own.
    await page.getByRole('button', { name: 'Clear Filters' }).first().click()
    await expect(page.locator('tbody tr', { hasText: ownedByB.ticketNumber })).toHaveCount(1)
  })

  test('search, filters, sorting and pagination', async ({ page, request }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)

    // Enough rows to page. Created up front so the list has depth to sort.
    const categories = await request.get(`${API}/api/categories`).then((r) => r.json())
    for (let i = 0; i < 12; i += 1) {
      await createTicket(request, requester.id, {
        summary: `Evidence ticket ${i + 1} — ${['VPN', 'printer', 'laptop'][i % 3]} issue`,
        categoryId: categories[i % categories.length].id,
        requestedPriority: (['LOW', 'MEDIUM', 'HIGH'] as const)[i % 3],
      })
    }

    await selectRequester(page, requester)
    await page.goto('/tickets')

    // --- Search ----------------------------------------------------------
    await page.getByLabel(/^Search/).fill('VPN')
    await page.getByRole('button', { name: 'Apply' }).click()
    // Retrying assertions, not allInnerTexts(): the previous rows stay on
    // screen while the request is in flight, so a snapshot read can capture
    // the unfiltered list and pass — or fail — for the wrong reason.
    await expect(page.locator('tbody tr')).not.toHaveCount(0)
    await expect(page.locator('tbody tr').filter({ hasNotText: /VPN/i })).toHaveCount(0)
    await page.screenshot({ path: shot('my-tickets', 'search'), fullPage: true })

    // --- Filters (Category + Priority together, AC-30) -------------------
    await page.getByRole('button', { name: 'Clear Filters' }).first().click()
    // Wait for the reset to land: it re-renders the controls, and setting a
    // value before that lands gets wiped by the render that follows.
    await expect(page.getByLabel(/^Requested Priority/)).toHaveValue('')
    await page.getByLabel(/^Category/).selectOption({ index: 1 })
    await page.getByLabel(/^Requested Priority/).selectOption('HIGH')
    await page.getByRole('button', { name: 'Apply' }).click()
    // Same reason as above: retry until the filtered set has actually landed.
    // A filter that silently did nothing would leave Medium and Low rows here.
    await expect(page.locator('tbody tr').filter({ hasText: 'Medium' })).toHaveCount(0)
    await expect(page.locator('tbody tr').filter({ hasText: 'Low' })).toHaveCount(0)
    await page.screenshot({ path: shot('my-tickets', 'filters'), fullPage: true })

    // --- Sorting (AC-16: High -> Medium -> Low) --------------------------
    await page.getByRole('button', { name: 'Clear Filters' }).first().click()
    await expect(page.getByLabel(/^Requested Priority/)).toHaveValue('')
    await page.getByRole('button', { name: /Requested Priority/i }).click()
    const header = page
      .getByRole('columnheader')
      .filter({ has: page.getByRole('button', { name: /Requested Priority/i }) })
    await expect(header).toHaveAttribute('aria-sort', 'descending')
    // The header's aria-sort above only lands once the sorted response has
    // rendered, so reading the column after it is safe.
    const priorities = await page.locator('tbody tr td:nth-child(3)').allInnerTexts()
    const rank = { High: 0, Medium: 1, Low: 2 } as Record<string, number>
    const ranks = priorities.map((p) => rank[p.trim()]).filter((r) => r !== undefined)
    expect(ranks.length).toBeGreaterThan(1)
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y))
    await page.screenshot({ path: shot('my-tickets', 'sorting'), fullPage: true })

    // --- Pagination (AC-15: page 2 is a different, non-overlapping set) ---
    const pageOne = await page.locator('tbody tr td:first-child').allInnerTexts()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByText(/Showing 11/)).toBeVisible()
    const pageTwo = await page.locator('tbody tr td:first-child').allInnerTexts()
    expect(pageOne.filter((n) => pageTwo.includes(n))).toEqual([])
    await page.screenshot({ path: shot('my-tickets', 'pagination'), fullPage: true })
  })
})

test.describe('Part 8 — Ticket Detail and attachments', () => {
  test('owned detail, add, download, remove with reason, retained metadata', async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const requester = await firstRequester(request)
    const ticket = await createTicket(request, requester.id, {
      summary: `Attachment lifecycle ${Date.now()}`,
    })
    await selectRequester(page, requester)

    // --- Owned Ticket Detail, read-only (AC-17) --------------------------
    await page.goto(`/tickets/${ticket.id}`)
    await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
    const card = page.locator('.ttk-detail__card')
    expect(await card.locator('input, select, textarea').count()).toBe(0)
    await page.screenshot({ path: shot('ticket-detail', 'owned-detail'), fullPage: true })

    // --- Add an attachment (AC-18) ---------------------------------------
    await page.getByLabel('Add an attachment').setInputFiles({
      name: 'evidence-photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
        'hex',
      ),
    })
    const row = page.locator('.ttk-attachments__row', { hasText: 'evidence-photo.png' })
    await expect(row).toBeVisible()
    await expect(row.getByRole('link', { name: 'Download' })).toBeVisible()
    await page.screenshot({ path: shot('ticket-detail', 'add-attachment'), fullPage: true })

    // --- Download an active attachment works (AC-19) ---------------------
    const link = row.getByRole('link', { name: 'Download' })
    const attachmentId = Number(
      (await link.getAttribute('href'))!.match(/attachments\/(\d+)\//)![1],
    )

    // Driven through the UI rather than the API: clicking the link is what
    // AC-19 actually describes, and the download event proves the browser
    // received a file with the original name rather than an error page.
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()])
    expect(download.suggestedFilename()).toBe('evidence-photo.png')

    // The page itself does not change when a file downloads, so the capture
    // focuses the control that was used — otherwise this file would be a
    // byte-identical copy of add-attachment.png and evidence nothing.
    await link.focus()
    await page.screenshot({ path: shot('ticket-detail', 'download-active'), fullPage: true })

    // --- Removal requires a reason (AC-22) -------------------------------
    await row.getByRole('button', { name: 'Remove' }).click()
    await page.getByLabel(/Reason for removal/).fill('Photo was out of focus')
    await expect(page.getByLabel(/Reason for removal/)).toHaveValue('Photo was out of focus')
    await page.screenshot({ path: shot('ticket-detail', 'remove-with-reason'), fullPage: true })

    // --- Retained metadata after removal (AC-20, BR-24) ------------------
    await page.getByRole('button', { name: 'Confirm removal' }).click()
    await expect(row.getByText('Removed')).toBeVisible()
    await expect(row.getByText(/Photo was out of focus/)).toBeVisible()
    await expect(row.getByRole('link', { name: 'Download' })).toHaveCount(0)
    await page.screenshot({ path: shot('ticket-detail', 'retained-metadata'), fullPage: true })

    // --- The removed file is no longer downloadable (AC-21, BR-26) -------
    // Asserted against the API, since the block is a server rule and the page
    // simply stops offering the link. Both halves are evidence.
    const blockedUrl = `${API}/api/attachments/${attachmentId}/download?requesterId=${requester.id}`
    const blocked = await request.get(blockedUrl)
    expect(blocked.status()).toBe(404)

    // Navigated to directly, so the refusal is what the screenshot shows.
    // Capturing the Detail page again would have produced a byte-identical
    // copy of retained-metadata.png, since the block is a server rule and the
    // page simply stops offering the link.
    const response = await page.goto(blockedUrl)
    expect(response!.status()).toBe(404)
    await expect(page.locator('body')).toContainText('Attachment not found')
    await page.screenshot({
      path: shot('ticket-detail', 'blocked-removed-download'),
      fullPage: true,
    })
  })

  test('unauthorized access to another Requester’s Ticket (AC-03, AC-34)', async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    const owner = await firstRequester(request)
    const other = await secondRequester(request)

    const ticket = await createTicket(request, owner.id, {
      summary: `Unauthorized-access evidence ${Date.now()}`,
    })
    const attachment = await attachFile(request, ticket.id, owner.id, 'private-evidence.png')

    // The other Requester, navigating directly to the URL.
    await selectRequester(page, other)
    await page.goto(`/tickets/${ticket.id}`)
    await expect(page.getByRole('alert')).toContainText(/Ticket not found/i)

    // Nothing about the Ticket leaks into the refusal.
    const body = await page.locator('body').innerText()
    expect(body).not.toContain(ticket.ticketNumber)
    expect(body).not.toContain(ticket.summary)
    await page.screenshot({ path: shot('ticket-detail', 'unauthorized-access'), fullPage: true })

    // AC-34: the same 404 for the Attachment's metadata, download and removal,
    // identical to a nonexistent id.
    const [metadata, download, removal, nonexistent] = await Promise.all([
      request.get(`${API}/api/attachments/${attachment.id}?requesterId=${other.id}`),
      request.get(`${API}/api/attachments/${attachment.id}/download?requesterId=${other.id}`),
      request.delete(`${API}/api/attachments/${attachment.id}`, {
        data: { requesterId: other.id, reason: 'not mine to remove' },
      }),
      request.get(`${API}/api/attachments/999999999?requesterId=${other.id}`),
    ])
    expect([metadata.status(), download.status(), removal.status()]).toEqual([404, 404, 404])
    expect(await metadata.json()).toEqual(await nonexistent.json())
  })
})
