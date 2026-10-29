import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  ACCOUNTS,
  API,
  FIXTURE_MARKER,
  actionsArea,
  attachFile,
  cookieFor,
  createTicket,
  createUser,
  editAction,
  firstRequester,
  loginAs,
  recordAction,
  signInThroughForm,
  workflowChange,
} from './helpers'

// REG-04 (Lab 4 FR-16, FR-17, AC-44; handout §8.6).
//
// The last look round before release: each role opens every screen it can
// reach, and every dialog on them, with something listening the whole time.
// Nothing here is about what a screen says. It is about what must be true of
// all of them:
//
//   - nothing is written to the console as an error, and nothing throws
//   - no request fails, and none is answered with an error status
//   - every link leads to a screen that exists and that this role may open
//   - every button and link has a name, and none is a dead `#`
//   - no placeholder text, and none of the strings a missing value leaves
//     behind ("undefined", "NaN", "Invalid Date")

/** What went wrong while a page was being watched, with where it happened. */
interface Watch {
  problems: string[]
  /** Something expected to fail in this step, such as the session check on
   *  the Login screen, which is answered 401 by design. */
  allow: (pattern: RegExp) => void
}

function watch(page: Page): Watch {
  const problems: string[] = []
  const allowed: RegExp[] = []
  const record = (kind: string, text: string) => {
    if (allowed.some((pattern) => pattern.test(text))) return
    problems.push(`${kind}: ${text} (on ${new URL(page.url()).pathname})`)
  }

  page.on('console', (message) => {
    if (message.type() === 'error') record('console error', `${message.text()} ${message.location().url}`)
  })
  page.on('pageerror', (error) => record('uncaught error', error.message))
  page.on('requestfailed', (request) =>
    record('request failed', `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`),
  )
  page.on('response', (response) => {
    if (response.status() >= 400) {
      record('error response', `${response.status()} ${response.request().method()} ${response.url()}`)
    }
  })

  return { problems, allow: (pattern) => allowed.push(pattern) }
}

const LEFTOVER =
  /lorem ipsum|\bTODO\b|\bTBD\b|\bFIXME\b|coming soon|not implemented|under construction|\bundefined\b|\bNaN\b|\[object Object\]|Invalid Date|\bnull\b/i

/** Reads the screen that is open for the things no screen may have. */
async function inspect(page: Page, what: string, links: Set<string>) {
  // Everything the screen asked for has come back before it is judged, and
  // before the next navigation could cut a request short.
  await page.waitForLoadState('networkidle')

  const found = await page.evaluate(() => {
    const visible = (el: HTMLElement) => {
      const style = getComputedStyle(el)
      return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0
    }
    const unnamed: string[] = []
    const dead: string[] = []
    const hrefs: string[] = []

    for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"]'))) {
      if (!visible(el)) continue
      const name = (el.getAttribute('aria-label') ?? el.innerText ?? '').trim() || el.getAttribute('title')
      if (!name) unnamed.push(el.outerHTML.slice(0, 120))

      if (el.tagName !== 'A') continue
      const href = el.getAttribute('href')
      if (!href || href === '#' || href.startsWith('javascript:')) dead.push(el.outerHTML.slice(0, 120))
      else if (href.startsWith('#')) {
        if (!document.getElementById(href.slice(1))) dead.push(`${href} names nothing on the page`)
      } else hrefs.push(href)
    }
    return { text: document.body.innerText, unnamed, dead, hrefs }
  })

  expect(found.text.match(LEFTOVER)?.[0] ?? null, `${what}: leftover text on screen`).toBeNull()
  expect(found.unnamed, `${what}: controls with no name`).toEqual([])
  expect(found.dead, `${what}: links that lead nowhere`).toEqual([])
  for (const href of found.hrefs) links.add(href)
}

/** Opens a screen, waits for what proves it has drawn, and inspects it. */
async function visit(page: Page, path: string, ready: Locator, links: Set<string>) {
  await page.goto(path)
  await expect(ready, `${path} did not draw`).toBeVisible()
  await inspect(page, path, links)
}

/** One link per shape: fifty rows of a list are one kind of link, not fifty. */
const shapeOf = (href: string) => href.replace(/\d+/g, ':n')

/**
 * Follows every link the role's screens offered. A link is good when the
 * address it names is the address that opens: an unknown address is sent to
 * the role's landing page, and one the role may not open says so.
 */
async function followLinks(page: Page, links: Set<string>, role: string) {
  const byShape = new Map<string, string>()
  for (const href of links) if (!byShape.has(shapeOf(href))) byShape.set(shapeOf(href), href)
  expect(byShape.size, `${role}: no links were collected`).toBeGreaterThan(3)

  for (const href of byShape.values()) {
    if (href.startsWith(API)) {
      // A file served by the API, not a screen.
      const response = await page.request.get(href)
      expect(response.status(), `${role}: ${href}`).toBe(200)
      continue
    }
    expect(href.startsWith('/'), `${role}: ${href} leaves the application`).toBe(true)

    await page.goto(href)
    await expect(page.getByRole('main').getByRole('heading').first(), `${role}: ${href} is blank`).toBeVisible()
    await page.waitForLoadState('networkidle')

    const here = new URL(page.url())
    const there = new URL(href, here.origin)
    expect(here.pathname, `${role}: ${href} was redirected`).toBe(there.pathname)
    expect(here.hash, `${role}: ${href} lost its fragment`).toBe(there.hash)
    await expect(page.getByText(/do not have permission/), `${role}: ${href} is forbidden`).toHaveCount(0)
    await expect(page.getByText(/could not be found|not found/i), `${role}: ${href} is missing`).toHaveCount(0)
  }
}

let ticket: { id: number; ticketNumber: string }

test.beforeAll(async ({ request }) => {
  // One Ticket with every part of the Lab 1 to 4 screens on it: an owner, a
  // file, a comment, a note, and work recorded by two people, one row of
  // which was edited and asks for follow-up.
  const requester = await firstRequester(request)
  ticket = await createTicket(request, requester, {
    summary: 'Regression sweep: laptop will not charge',
    description: `Stopped charging this morning. Reported during the ${FIXTURE_MARKER}.`,
  })
  await attachFile(request, ticket.id, requester, 'charger-label.png')

  const sarah = await cookieFor(request, ACCOUNTS.staff.email)
  const me = (await (await request.get(`${API}/api/auth/me`, { headers: { Cookie: sarah } })).json()).user
  await workflowChange(request, ticket.id, 'owner', { ownerId: me.id }, sarah)
  await workflowChange(request, ticket.id, 'status', { currentStatus: 'IN_PROGRESS' }, sarah)
  for (const visibility of ['PUBLIC', 'INTERNAL']) {
    const posted = await request.post(`${API}/api/tickets/${ticket.id}/comments`, {
      headers: { Cookie: sarah },
      data: { body: `Regression sweep ${visibility.toLowerCase()} entry.`, visibility },
    })
    expect(posted.status(), await posted.text()).toBe(201)
  }

  const first = await recordAction(request, ticket.id, sarah, {
    followUpRequired: true,
    followUpNote: 'Hand over the replacement charger.',
    attachmentNotes: 'Photo of the charger label.',
  })
  const admin = await cookieFor(request, ACCOUNTS.admin.email)
  await editAction(request, ticket.id, first.id, admin, { result: 'The charger is dead. The ports are fine.' })
  await recordAction(request, ticket.id, admin)
})

test('REG-04: nobody is signed in', async ({ page }) => {
  const seen = watch(page)
  const links = new Set<string>()
  // The Login screen asks who is signed in, and the answer is 401. That is
  // the session check working, and the browser reports it in the console.
  seen.allow(/401 GET .*\/api\/auth\/me/)
  seen.allow(/status of 401.*\/api\/auth\/me/)

  await visit(page, '/login', page.getByRole('heading', { name: 'Sign in' }), links)

  // A protected address leads back here and not to a blank page.
  await page.goto(`/staff/tickets/${ticket.id}`)
  await expect(page).toHaveURL(/\/login$/)
  await inspect(page, 'a protected address, signed out', links)

  expect(seen.problems).toEqual([])
})

test('REG-04: a new user, held at the password change', async ({ page, request }) => {
  const newcomer = await createUser(request, { name: 'Robin Regression', role: 'REQUESTER', label: 'reg-newcomer' })
  const seen = watch(page)
  const links = new Set<string>()
  seen.allow(/401 GET .*\/api\/auth\/me/)
  seen.allow(/status of 401.*\/api\/auth\/me/)

  await signInThroughForm(page, newcomer.email, newcomer.password)
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
  await inspect(page, '/change-password', links)

  // Every other address is closed to them until they have chosen one.
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/change-password$/)
  await inspect(page, '/dashboard before the password change', links)

  expect(seen.problems).toEqual([])
})

test('REG-04: the Requester', async ({ page }) => {
  await loginAs(page, 'requester')
  const seen = watch(page)
  const links = new Set<string>()

  await visit(page, '/dashboard', page.getByTestId('metric-openTickets'), links)
  await visit(page, '/tickets', page.getByRole('table'), links)
  await visit(page, '/tickets?status=ACTIVE&sortBy=updatedAt', page.getByRole('table'), links)
  await visit(page, '/tickets/new', page.getByLabel(/^Category/), links)

  await page.goto(`/tickets/${ticket.id}`)
  await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
  const area = actionsArea(page)
  await expect(area.getByText('2 Actions Taken', { exact: true })).toBeVisible()
  await expect(page.getByText('Regression sweep public entry.')).toBeVisible()
  await inspect(page, 'Ticket Detail', links)

  await area.getByRole('row').nth(1).getByRole('button', { name: /^View the Action Taken/ }).click()
  await expect(page.getByRole('dialog', { name: 'Action Taken', exact: true })).toBeVisible()
  await inspect(page, 'the Action Taken dialog, read-only', links)
  await page.keyboard.press('Escape')

  // Every destination in their navigation was one of the screens above.
  const nav = await page.getByRole('navigation', { name: 'Primary' }).getByRole('link').allTextContents()
  expect(nav).toEqual(['Dashboard', 'My Tickets', 'Create Ticket'])

  await followLinks(page, links, 'Requester')
  expect(seen.problems).toEqual([])
})

test('REG-04: IT Staff', async ({ page }) => {
  await loginAs(page, 'staff')
  const seen = watch(page)
  const links = new Set<string>()

  await visit(page, '/staff/dashboard', page.getByTestId('by-status'), links)
  await visit(page, '/staff/tickets', page.getByRole('table'), links)
  await visit(page, '/staff/tickets?owner=me&status=ACTIVE', page.getByTestId('list-total'), links)

  await page.goto(`/staff/tickets/${ticket.id}`)
  await expect(page.getByRole('heading', { name: ticket.ticketNumber })).toBeVisible()
  const area = actionsArea(page)
  await expect(area.getByText('2 Actions Taken', { exact: true })).toBeVisible()
  await expect(page.locator('.ttk-thread--internal')).toContainText('Regression sweep internal entry.')
  await inspect(page, 'staff Ticket Detail', links)

  await area.getByRole('button', { name: 'Add Action Taken' }).click()
  await expect(page.getByRole('dialog', { name: 'Add Action Taken' })).toBeVisible()
  await inspect(page, 'the Add Action Taken dialog', links)
  await page.keyboard.press('Escape')

  await area.getByRole('row').nth(1).getByRole('button', { name: /^View the Action Taken/ }).click()
  const view = page.getByRole('dialog', { name: 'Action Taken', exact: true })
  await expect(view).toBeVisible()
  await inspect(page, 'the Action Taken dialog', links)
  await view.getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit Action Taken' })).toBeVisible()
  await inspect(page, 'the Edit Action Taken dialog', links)
  await page.keyboard.press('Escape')

  const nav = await page.getByRole('navigation', { name: 'Primary' }).getByRole('link').allTextContents()
  expect(nav).toEqual(['Dashboard', 'Ticket Queue'])

  await followLinks(page, links, 'IT Staff')
  expect(seen.problems).toEqual([])
})

test('REG-04: the Administrator', async ({ page }) => {
  await loginAs(page, 'admin')
  const seen = watch(page)
  const links = new Set<string>()

  await visit(page, '/staff/dashboard', page.getByTestId('user-accounts'), links)
  await visit(page, '/staff/tickets', page.getByRole('table'), links)
  await visit(page, `/staff/tickets/${ticket.id}`, page.getByRole('heading', { name: ticket.ticketNumber }), links)

  await visit(page, '/admin/users', page.getByRole('table'), links)
  await page.getByRole('button', { name: 'New user' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await inspect(page, 'the New user dialog', links)
  await page.keyboard.press('Escape')
  await page.getByRole('table').getByRole('button', { name: `Edit ${ACCOUNTS.staff.name}` }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await inspect(page, 'the Edit user dialog', links)
  await page.keyboard.press('Escape')

  await visit(page, '/system-status', page.getByText('Online', { exact: true }), links)

  const nav = await page.getByRole('navigation', { name: 'Primary' }).getByRole('link').allTextContents()
  expect(nav).toEqual(['Dashboard', 'Ticket Queue', 'User Management', 'System Status'])

  await followLinks(page, links, 'Administrator')
  expect(seen.problems).toEqual([])
})
