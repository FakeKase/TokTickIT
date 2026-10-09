import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  ACCOUNTS,
  FIXTURE_MARKER,
  VIEWPORTS,
  cookieFor,
  createTicket,
  createUser,
  expectNoHorizontalScroll,
  firstRequester,
  loginAs,
  shot,
  signInThroughForm,
  API,
  workflowChange,
} from './helpers'

/**
 * ui-spec.md §10, one assertion per checklist line (RESP-01 to RESP-05).
 *
 * A screenshot passes just as happily when the layout is broken, so nothing
 * here is decided by looking at one. The captures are kept as evidence for
 * submission Part 9, and are only written on the fresh database, for the same
 * reason as submission-evidence.spec.ts.
 */

const FRESH = Boolean(process.env.E2E_FRESH)
const capture = async (page: Page, screen: string, viewport: string, theme: string, fullPage = true) => {
  if (!FRESH) return
  await page.screenshot({
    path: shot('responsive', `${screen}-${viewport}${theme === 'dark' ? '-dark' : ''}`),
    fullPage,
  })
}

/** Nothing on the page is wider than its own box: no clipped label, badge or
 *  button. Elements built to truncate with an ellipsis are exempt, since that
 *  is them working. */
async function expectNothingClipped(page: Page) {
  const clipped = await page.evaluate(() => {
    const found: string[] = []
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>('.ttk-btn, .ttk-badge, label, h1, h2, h3, th, legend'),
    )) {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || el.offsetParent === null) continue
      if (style.textOverflow === 'ellipsis') continue
      if (el.scrollWidth > el.clientWidth + 1 && style.overflow !== 'visible') {
        found.push(`${el.tagName.toLowerCase()}.${el.className}: "${el.textContent?.trim().slice(0, 30)}"`)
      }
    }
    return found
  })
  expect(clipped, 'elements whose text is cut off').toEqual([])
}

/** The boxes of two visible elements do not intersect. */
async function expectNoOverlap(first: Locator, second: Locator, what: string) {
  // Both must be there to be compared. Returning quietly when one is missing
  // would let this pass on a header that had lost the element entirely.
  await expect(first, `${what}: first element`).toBeVisible()
  await expect(second, `${what}: second element`).toBeVisible()
  const [a, b] = [await first.boundingBox(), await second.boundingBox()]
  if (!a || !b) throw new Error(`${what}: no box to measure`)
  const apart = a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5
  expect(apart, `${what} overlap`).toBe(true)
}

async function setTheme(page: Page, theme: string) {
  await page.addInitScript((value) => localStorage.setItem('toktickit.theme', value), theme)
}

const UNBREAKABLE_FILE = 'midterm_marks_final_FINAL_v7_corrected_resubmission_2026_section_1.xlsx'
const UNBREAKABLE_URL =
  'https://grades.example.edu/submissions/2026/term-1/upload?course=CPE334&section=1&attempt=7&token=abcdef0123456789'
const UNBREAKABLE_NAME = 'Wolfeschlegelsteinhausenbergerdorff-Featherstonehaugh'

let ticket: { id: number; ticketNumber: string }
/** One account still holding its initial password, for the Change Password
 *  screen. One, shared by every viewport and theme: it never completes the
 *  change, so it can be used again, and the user list gains one row instead
 *  of six. */
let newcomer: { email: string; password: string }

test.beforeAll(async ({ request }) => {
  // One Ticket with everything on it that stresses a layout: a long status,
  // an owner, a comment and a note, and above all text that cannot wrap. A
  // table cell cannot be narrower than its longest word, so a file name or a
  // URL is what breaks a layout that looked fine with tidy sentences. People
  // paste both into Tickets all the time.
  const requester = await firstRequester(request)
  ticket = await createTicket(request, requester, {
    summary: `Upload of ${UNBREAKABLE_FILE} is rejected`,
    description: `Uploading the mid-term marks fails at the confirmation step. Reported during the ${FIXTURE_MARKER}. The same file opens correctly in the spreadsheet application and was accepted last term.`,
    requestedPriority: 'HIGH',
  })
  const staff = await cookieFor(request, ACCOUNTS.staff.email)
  const send = (method: 'patch' | 'post', path: string, data: unknown) =>
    request[method](`${API}${path}`, { headers: { Cookie: staff }, data })
  const me = (await (await request.get(`${API}/api/auth/me`, { headers: { Cookie: staff } })).json()).user
  await workflowChange(request, ticket.id, 'owner', { ownerId: me.id }, staff)
  await workflowChange(request, ticket.id, 'it-priority', { itPriority: 'URGENT' }, staff)
  await workflowChange(request, ticket.id, 'status', { currentStatus: 'IN_PROGRESS' }, staff)
  await workflowChange(request, ticket.id, 'status', { currentStatus: 'WAITING_FOR_REQUESTER' }, staff)
  await send('post', `/api/tickets/${ticket.id}/comments`, { body: `Could you try the upload again from ${UNBREAKABLE_URL} and tell us which browser you are using?`, visibility: 'PUBLIC' })
  await send('post', `/api/tickets/${ticket.id}/comments`, { body: `Likely the column-order check added last month. See ${UNBREAKABLE_URL} before replying.`, visibility: 'INTERNAL' })

  // And a person whose name has no spaces in it, for the user list, the
  // reassign control and the header.
  await createUser(request, { name: UNBREAKABLE_NAME, role: 'IT_STAFF', label: 'resp-long-name' })
  newcomer = await createUser(request, { name: 'Casey Whitlock', role: 'REQUESTER', label: 'resp-newcomer' })
})

test.describe('RESP-01 (AC-42): no overflow, clipping or overlap, at three widths in both themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const [viewport, size] of Object.entries(VIEWPORTS)) {
      test(`every Lab 3 screen at ${viewport}, ${theme}`, async ({ page }) => {
        await setTheme(page, theme)
        await page.setViewportSize(size)
        const check = async (screen: string) => {
          await expectNoHorizontalScroll(page, size.width)
          await expectNothingClipped(page)
          await capture(page, screen, viewport, theme)
        }

        // Outside the shell.
        await page.goto('/login')
        await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
        await check('login')

        await signInThroughForm(page, newcomer.email, newcomer.password)
        await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
        await check('change-password')
        await page.context().clearCookies()

        // IT Staff.
        await loginAs(page, 'staff')
        await page.goto('/staff/tickets')
        await expect(page.locator('.ttk-queue__number').first()).toBeAttached()
        await check('staff-queue')
        if (viewport === 'mobile') {
          await page.getByRole('button', { name: /^Filters/ }).click()
          await expect(page.getByLabel('Status')).toBeVisible()
          await check('staff-queue-filters')
        }

        await page.goto(`/staff/tickets/${ticket.id}`)
        await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
        await expect(page.locator('.ttk-thread--internal')).toBeVisible()
        await check('staff-ticket-detail')
        await page.context().clearCookies()

        // The Requester's screens, which Lab 3 changed: longer status labels,
        // the comment thread, and the resolved signal.
        await loginAs(page, 'requester')
        await page.goto('/tickets')
        await expect(page.getByRole('heading', { name: 'My Tickets' })).toBeVisible()
        await expect(page.locator('.ttk-my-tickets__table, .ttk-my-tickets__cards').first()).toBeAttached()
        await check('my-tickets')

        await page.goto(`/tickets/${ticket.id}`)
        await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
        await check('ticket-detail')
        await page.context().clearCookies()

        // Administrator.
        await loginAs(page, 'admin')
        await page.goto('/admin/users')
        await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible()
        await expect(page.locator('.ttk-users__table, .ttk-users__cards').first()).toBeAttached()
        await check('user-management')

        await page.getByRole('button', { name: 'New user' }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
        // The page behind is held still while the dialog is open.
        expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden')
        await expectNoHorizontalScroll(page, size.width)
        await expectNothingClipped(page)
        // What is on screen, not the page behind it.
        await capture(page, 'user-dialog', viewport, theme, false)
      })
    }
  }

  test('the header never lets the name run into the role badge, or anything past the edge', async ({ page }) => {
    for (const role of ['requester', 'staff', 'admin'] as const) {
      await page.context().clearCookies()
      await loginAs(page, role)
      for (const size of Object.values(VIEWPORTS)) {
        await page.setViewportSize(size)
        await page.goto(ACCOUNTS[role].home)
        const header = page.getByRole('banner')
        await expect(header.locator('.ttk-shell__role')).toBeVisible()
        await expectNoHorizontalScroll(page, size.width)
        if (size.width >= 768) {
          await expectNoOverlap(header.locator('.ttk-shell__user-name'), header.locator('.ttk-shell__role'), `${role} name and role badge at ${size.width}px`)
        }
        await expectNoOverlap(header.locator('.ttk-shell__role'), header.getByRole('button', { name: 'Log out' }), `${role} role badge and Log out at ${size.width}px`)
      }
    }
  })
})

test.describe('role navigation shows only permitted destinations', () => {
  const NAV = {
    requester: ['My Tickets', 'Create Ticket'],
    staff: ['Ticket Queue'],
    admin: ['Ticket Queue', 'User Management'],
  }

  for (const role of ['requester', 'staff', 'admin'] as const) {
    test(`${role}, on desktop and behind the mobile menu`, async ({ page }) => {
      await loginAs(page, role)
      await page.goto(ACCOUNTS[role].home)
      const nav = page.getByRole('banner').getByRole('navigation')
      await expect(nav.getByRole('link')).toHaveText(NAV[role])

      await page.setViewportSize(VIEWPORTS.mobile)
      await page.getByRole('banner').getByRole('button', { name: /menu|navigation/i }).click()
      await expect(nav.getByRole('link')).toHaveText(NAV[role])
      for (const link of await nav.getByRole('link').all()) await expect(link).toBeVisible()
    })
  }
})

test.describe('RESP-04: three badge families, told apart by more than their text', () => {
  test('status, IT Priority and role badges are mutually distinct, and each says what it is', async ({ page }) => {
    await loginAs(page, 'staff')
    await page.goto(`/staff/tickets/${ticket.id}`)
    await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()

    const look = (locator: Locator) =>
      locator.evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          text: el.textContent?.trim() ?? '',
          signature: `${style.backgroundColor}|${style.color}|${style.borderTopWidth} ${style.borderTopColor}`,
        }
      })

    const workflow = page.getByRole('region', { name: 'Workflow' })
    const status = await look(workflow.locator('.ttk-badge', { hasText: 'Waiting for Requester' }))
    const itPriority = await look(workflow.locator('.ttk-badge', { hasText: 'Urgent' }))
    const requested = await look(page.getByTestId('requested-priority').locator('.ttk-badge'))
    const role = await look(page.getByRole('banner').locator('.ttk-shell__role'))
    const commentRole = await look(page.locator('.ttk-thread__role').first())

    for (const badge of [status, itPriority, requested, role, commentRole]) {
      expect(badge.text.length, 'a badge with no label').toBeGreaterThan(0)
    }
    const families = [status.signature, itPriority.signature, role.signature]
    expect(new Set(families).size, `status, IT Priority and role look alike: ${families.join(' / ')}`).toBe(3)
    // Requested and IT Priority sit side by side and must not be confused.
    expect(requested.signature).not.toBe(itPriority.signature)
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`every badge label is readable on its own fill, and only Urgent is filled (${theme})`, async ({ page }) => {
      await setTheme(page, theme)
      await loginAs(page, 'staff')
      await page.goto('/staff/tickets')
      await expect(page.locator('.ttk-queue__number').first()).toBeAttached()

      const badges = await page.evaluate(() => {
        const luminance = (rgb: string) => {
          const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
            const channel = Number(value) / 255
            return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
          })
          return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
        return Array.from(document.querySelectorAll<HTMLElement>('.ttk-queue__table .ttk-badge, .ttk-shell__role')).map((el) => {
          const style = getComputedStyle(el)
          const [bg, fg] = [luminance(style.backgroundColor), luminance(style.color)]
          return {
            text: el.textContent?.trim(),
            contrast: (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05),
            white: style.color === 'rgb(255, 255, 255)',
          }
        })
      })

      // Enough variety on the page for this to mean something.
      expect(new Set(badges.map((badge) => badge.text)).size).toBeGreaterThanOrEqual(8)
      expect([...new Set(badges.filter((badge) => badge.white).map((badge) => badge.text))]).toEqual(['Urgent'])
      // WCAG AA for text this size. A badge is a word; if the word cannot be
      // read, colour is carrying the meaning alone.
      for (const badge of badges) {
        expect(badge.contrast, `"${badge.text}" badge contrast in ${theme}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})

test.describe('RESP-02 and RESP-03: what can be edited, and who reads what', () => {
  test('the workflow panel looks different from the read-only Ticket beside it', async ({ page }) => {
    await loginAs(page, 'staff')
    await page.goto(`/staff/tickets/${ticket.id}`)
    const background = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor)

    const panel = await background(page.getByRole('region', { name: 'Workflow' }))
    const card = await background(page.locator('.ttk-detail__card'))
    const readOnlyValue = await background(page.locator('.ttk-detail__value').first())
    const editable = await background(page.getByLabel('IT Priority'))

    expect(panel).not.toBe(card)
    expect(readOnlyValue).not.toBe(editable)
    // Nothing in the read-only card can be typed into or changed.
    await expect(page.locator('.ttk-detail__card').locator('input, select, textarea, button')).toHaveCount(0)
  })

  test('Internal Notes sit on a different surface from Public Comments, with a rule down the side', async ({ page }) => {
    await loginAs(page, 'staff')
    await page.goto(`/staff/tickets/${ticket.id}`)
    const publicStream = page.locator('.ttk-thread').filter({ hasText: 'Public Comments' })
    const internalStream = page.locator('.ttk-thread--internal')
    await expect(internalStream).toBeVisible()

    const surface = (locator: Locator) =>
      locator.evaluate((el) => {
        const style = getComputedStyle(el)
        return { background: style.backgroundColor, rule: parseFloat(style.borderLeftWidth), ruleColor: style.borderLeftColor }
      })
    const [open, closed] = [await surface(publicStream), await surface(internalStream)]

    expect(closed.background).not.toBe(open.background)
    expect(closed.rule).toBeGreaterThanOrEqual(3)
    expect(closed.ruleColor).not.toBe(open.ruleColor)
    // And each says who reads it, in words, above its own composer.
    await expect(publicStream.getByText('Visible to the Requester.')).toBeVisible()
    await expect(internalStream.getByText(/The Requester never sees these/).first()).toBeVisible()
  })
})

test.describe('validation messages sit directly below their own field', () => {
  /** The message is inside the same field wrapper as its control, starts below
   *  it, and close to it. */
  async function expectMessageUnder(control: Locator, what: string) {
    const describedBy = await control.getAttribute('aria-describedby')
    expect(describedBy, `${what} has no described-by message`).toBeTruthy()
    const message = control.page().locator(`[id="${describedBy!.split(' ').pop()}"]`)
    await expect(message).toBeVisible()

    const [field, text] = [await control.boundingBox(), await message.boundingBox()]
    expect(text!.y, `${what}: message is not below its field`).toBeGreaterThanOrEqual(field!.y + field!.height - 1)
    expect(text!.y - (field!.y + field!.height), `${what}: message is far from its field`).toBeLessThan(24)
    await expect(control).toHaveAttribute('aria-invalid', 'true')
  }

  test('Login', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expectMessageUnder(page.getByLabel('Email address'), 'Email address')
    await expectMessageUnder(page.getByLabel(/^Password/), 'Password')
  })

  test('Change Password', async ({ page, request }) => {
    const user = await createUser(request, { name: 'Vera Validation', role: 'REQUESTER', label: 'resp-validation' })
    await signInThroughForm(page, user.email, user.password)
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()

    await page.getByLabel(/^Current password/).fill(user.password)
    await page.getByLabel(/^New password/).fill('short')
    await page.getByLabel(/^Confirm new password/).fill('different')
    await page.getByRole('button', { name: 'Save and continue' }).click()
    await expectMessageUnder(page.getByLabel(/^New password/), 'New password')
    await expectMessageUnder(page.getByLabel(/^Confirm new password/), 'Confirm new password')
  })

  test('the user dialog', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/users')
    await page.getByRole('button', { name: 'New user' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Create user' }).click()

    await expectMessageUnder(dialog.getByLabel(/^Name/), 'Name')
    await expectMessageUnder(dialog.getByLabel(/^Email/), 'Email')
    await expectMessageUnder(dialog.getByLabel(/^Initial password/), 'Initial password')
    await expect(dialog.getByText('Choose a role')).toBeVisible()
  })
})

test.describe('RESP-05 (AC-43): focus is visible, and the dialog keeps it', () => {
  /** Tabs through the page and reports any control that takes focus without
   *  showing it. */
  async function tabThrough(page: Page, presses: number, within?: Locator) {
    const unseen: string[] = []
    const visited = new Set<string>()
    for (let press = 0; press < presses; press += 1) {
      await page.keyboard.press('Tab')
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        const style = getComputedStyle(el)
        const ring = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
        const shadow = style.boxShadow !== 'none'
        return {
          name: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}"`,
          shown: ring || shadow,
        }
      })
      if (!info) continue
      visited.add(info.name)
      if (!info.shown) unseen.push(info.name)
      if (within) expect(await within.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    }
    expect(unseen, 'controls that take focus without showing it').toEqual([])
    return visited
  }

  test('Login', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    const visited = await tabThrough(page, 6)
    expect(visited.size).toBeGreaterThanOrEqual(3)
  })

  test('Change Password', async ({ page, request }) => {
    const user = await createUser(request, { name: 'Fenn Focus', role: 'REQUESTER', label: 'resp-focus' })
    await signInThroughForm(page, user.email, user.password)
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    const visited = await tabThrough(page, 8)
    expect(visited.size).toBeGreaterThanOrEqual(5)
  })

  test('User Management, the queue and the staff Ticket', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/users')
    await expect(page.getByRole('table')).toBeVisible()
    expect((await tabThrough(page, 14)).size).toBeGreaterThanOrEqual(8)

    await page.goto('/staff/tickets')
    await expect(page.getByRole('table')).toBeVisible()
    expect((await tabThrough(page, 20)).size).toBeGreaterThanOrEqual(12)

    await page.goto(`/staff/tickets/${ticket.id}`)
    await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
    expect((await tabThrough(page, 20)).size).toBeGreaterThanOrEqual(10)
  })

  test('the user dialog traps focus, shows it, and gives it back', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/users')
    const opener = page.getByRole('button', { name: 'New user' })
    await opener.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel(/^Name/)).toBeFocused()

    // More presses than the dialog has controls: focus must come back round.
    await tabThrough(page, 14, dialog)

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
  })
})

test.describe('guard-rails and consistency with Lab 2', () => {
  test('a disabled guard-rail control has its reason visible beside it', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/admin/users')
    await page.getByRole('table').getByRole('button', { name: `Edit ${ACCOUNTS.admin.name}` }).click()
    const dialog = page.getByRole('dialog')
    const active = dialog.getByRole('checkbox', { name: 'Active' })
    await expect(active).toBeDisabled()

    const reason = dialog.locator('#active-reason')
    await expect(reason).toBeVisible()
    const [box, text] = [await active.boundingBox(), await reason.boundingBox()]
    expect(text!.y - (box!.y + box!.height)).toBeLessThan(24)
    await expect(dialog.locator('#role-reason')).toBeVisible()
  })

  test('the new screens use the same buttons, fields and tokens as the Lab 2 ones', async ({ page }) => {
    const styleOf = (locator: Locator) =>
      locator.first().evaluate((el) => {
        const style = getComputedStyle(el)
        return [style.backgroundColor, style.color, style.borderRadius, style.fontWeight, style.fontFamily, style.minHeight].join('|')
      })

    // The Lab 2 reference: Create Ticket's primary button and a text field.
    await loginAs(page, 'requester')
    await page.goto('/tickets/new')
    const lab2Primary = await styleOf(page.getByRole('button', { name: 'Create Ticket' }))
    const lab2Field = await styleOf(page.getByLabel(/^Summary/))
    const lab2Secondary = await styleOf(page.locator('.ttk-btn--secondary'))
    await page.context().clearCookies()

    await loginAs(page, 'admin')
    await page.goto('/admin/users')
    expect(await styleOf(page.getByRole('button', { name: 'New user' }))).toBe(lab2Primary)
    await page.getByRole('button', { name: 'New user' }).click()
    expect(await styleOf(page.getByRole('dialog').getByLabel(/^Name/))).toBe(lab2Field)
    expect(await styleOf(page.getByRole('dialog').getByRole('button', { name: 'Cancel' }))).toBe(lab2Secondary)
    await page.keyboard.press('Escape')

    await page.goto(`/staff/tickets/${ticket.id}`)
    expect(await styleOf(page.getByRole('button', { name: 'Post comment' }))).toBe(lab2Primary)
    expect(await styleOf(page.getByRole('button', { name: 'Add internal note' }))).toBe(lab2Secondary)

    await page.context().clearCookies()
    await page.goto('/login')
    expect(await styleOf(page.getByLabel('Email address'))).toBe(lab2Field)
  })
})
