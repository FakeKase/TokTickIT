import { expect } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

/** The API the suite talks to. Follows playwright.config.ts, which follows
 *  E2E_API_PORT, so a run on its own ports reaches its own server. */
export const API = `http://localhost:${process.env.E2E_API_PORT ?? 3001}`

/** ui-spec.md §8's three breakpoints, and the widths §11 names its files after. */
export const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  tablet: { width: 820, height: 1000 },
  mobile: { width: 375, height: 800 },
} as const

export type ViewportName = keyof typeof VIEWPORTS

export const shot = (screen: string, name: string) =>
  `artifacts/lab-02/screenshots/${screen}/${name}.png`

export interface SeedRequester {
  id: number
  name: string
  email: string
}

/** The first active seeded Requester, used as the demo identity throughout. */
/**
 * The seeded Requesters these specs drive, by the addresses the README
 * documents.
 *
 * Lab 2 asked the API for them, through an endpoint that existed to feed the
 * selector. That endpoint is gone (api-spec.md §5) and listing people is an
 * Administrator capability now, so the fixtures are named here instead - which
 * is also more honest about what they are: a seed the suite depends on, not a
 * discovery mechanism.
 */
const SEEDED_REQUESTERS = [
  { email: 'peter.parker@toktickit.test', name: 'Peter Parker' },
  { email: 'ned.leeds@toktickit.test', name: 'Ned Leeds' },
  { email: 'michelle.jones@toktickit.test', name: 'Michelle Jones' },
  { email: 'roronoa.zoro@toktickit.test', name: 'Roronoa Zoro' },
] as const

/**
 * Reserved for the Empty state, and deliberately not in the list above: the
 * first spec to create a Ticket for a Requester destroys that Requester as an
 * Empty-state fixture, so the one account BR-28 needs is kept out of the
 * general pool.
 */
const EMPTY_STATE_REQUESTER = {
  email: 'grace.lim@toktickit.test',
  name: 'Grace Lim',
} as const

/** Signs in with the API context and returns the identity the session carries. */
async function identify(
  request: APIRequestContext,
  account: { email: string; name: string },
): Promise<SeedRequester> {
  const response = await request.post(`${API}/api/auth/login`, {
    data: { email: account.email, password: DEV_PASSWORD },
  })
  expect(
    response.ok(),
    `could not sign in as ${account.email} — is the database seeded?`,
  ).toBe(true)
  const { user } = (await response.json()) as { user: SeedRequester }
  return user
}

/** The identity these specs use by default. */
export async function firstRequester(request: APIRequestContext): Promise<SeedRequester> {
  return identify(request, SEEDED_REQUESTERS[0])
}

/** A second identity, for anything that needs two distinct Requesters. */
export async function secondRequester(request: APIRequestContext): Promise<SeedRequester> {
  return identify(request, SEEDED_REQUESTERS[1])
}

/**
 * The Requester reserved for the Empty state (BR-28).
 *
 * Asserted rather than searched for. Lab 2 asked every Requester whether they
 * owned anything, which needed an endpoint that listed people and a query
 * parameter naming one; both are gone. Naming the account makes the dependency
 * explicit, and failing loudly here is better than silently returning somebody
 * who happens to be empty today.
 */
export async function requesterWithoutTickets(
  request: APIRequestContext,
): Promise<SeedRequester> {
  const requester = await identify(request, EMPTY_STATE_REQUESTER)

  const list = await request.get(`${API}/api/tickets?pageSize=1`, {
    headers: { Cookie: await sessionCookieFor(request, EMPTY_STATE_REQUESTER.email) },
  })
  const { pagination } = (await list.json()) as { pagination: { totalItems: number } }
  expect(
    pagination.totalItems,
    `${EMPTY_STATE_REQUESTER.email} is reserved for the Empty state but owns Tickets — ` +
      'run the e2e teardown, or reseed',
  ).toBe(0)

  return requester
}

/** The raw Set-Cookie value for a seeded account, for a request made outside
 *  the page's own context. */
export async function sessionCookieFor(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const response = await request.post(`${API}/api/auth/login`, {
    data: { email, password: DEV_PASSWORD },
  })
  expect(response.ok(), `could not sign in as ${email}`).toBe(true)
  const header = response.headers()['set-cookie'] ?? ''
  return header.split(';')[0]
}

/**
 * Written into every Ticket this suite creates, however it is created, so the
 * teardown can find them all. server/src/scripts/e2e-cleanup.ts filters on the
 * same string, and a spec asserts the two still match.
 *
 * A Ticket submitted through the form counts too: it is a real row in the same
 * database, and one that skips this marker leaks on every run.
 */
export const FIXTURE_MARKER = 'TokTickIT walkthrough'

/** Rotated so a captured list looks like real tickets, not one fixture repeated. */
const SUMMARIES = [
  'Projector will not power on in LX-204',
  'Wi-Fi drops in the library basement',
  'VPN disconnects every few minutes',
  'Printer on floor 3 jams on duplex jobs',
  'Cannot sign in to the Grade Submission App',
  'Laptop battery drains within an hour',
]
let summaryCursor = 0

export async function createTicket(
  request: APIRequestContext,
  requester: SeedRequester,
  overrides: Record<string, unknown> = {},
) {
  // The API takes the Requester from the session now, so the fixture signs in
  // as them rather than naming them (BR-03).
  const cookie = await sessionCookieFor(request, requester.email)

  const [categories, systems] = await Promise.all([
    request.get(`${API}/api/categories`).then((r) => r.json()),
    request.get(`${API}/api/related-systems`).then((r) => r.json()),
  ])

  const response = await request.post(`${API}/api/tickets`, {
    headers: { Cookie: cookie },
    data: {
      categoryId: categories[0].id,
      relatedSystemId: systems[0].id,
      requestedPriority: 'HIGH',
      summary: SUMMARIES[summaryCursor++ % SUMMARIES.length],
      description: `Reported by the Requester during the ${FIXTURE_MARKER}. Steps tried so far are noted here so the Detail screen has realistic body text to render.`,
      ...overrides,
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  return response.json()
}

export async function attachFile(
  request: APIRequestContext,
  ticketId: number,
  requester: SeedRequester,
  name = 'evidence.png',
) {
  const response = await request.post(`${API}/api/tickets/${ticketId}/attachments`, {
    headers: { Cookie: await sessionCookieFor(request, requester.email) },
    multipart: {
      file: {
        name,
        mimeType: 'image/png',
        // A 1x1 PNG is enough: these specs assert on the row, not the pixels.
        buffer: Buffer.from(
          '89504e470d0a1a0a0000000d494844520000000100000001080600000' + '01f15c489',
          'hex',
        ),
      },
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  return response.json()
}

/** The password every seeded account shares (README, BR-39). */
export const DEV_PASSWORD = 'ChangeMe123!'

/**
 * Puts the browser in the "already signed in" state.
 *
 * Lab 2 wrote a localStorage key here, because identity was a client-side
 * choice. It is a session cookie now, so the shortcut is a real login through
 * the API: the session it produces is indistinguishable from one obtained by
 * typing in the form, and a failure in these specs still points at the screen
 * under test rather than at the login flow.
 */
export async function selectRequester(page: Page, requester: SeedRequester) {
  const response = await page.request.post(`${API}/api/auth/login`, {
    data: { email: requester.email, password: DEV_PASSWORD },
  })
  expect(
    response.ok(),
    `could not sign in as ${requester.email} - is the database seeded?`,
  ).toBe(true)
}

/**
 * Signs in the way a person does: through the Login screen (AC-01).
 *
 * The API shortcut above is right for the visual specs, where login is not
 * what is under test — but a flow that skips the form never proves the form
 * works, so E2E-01 uses this instead.
 */
export async function signInThroughLogin(page: Page, requester: SeedRequester) {
  // Landing on a guarded route must send us to Login (AC-13).
  await page.goto('/tickets')
  await expect(page).toHaveURL(/\/login$/)

  await page.getByLabel('Email address').fill(requester.email)
  await page.getByLabel(/^Password/).fill(DEV_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Resumes the route the guard interrupted.
  await expect(page).toHaveURL(/\/tickets$/)
  await expect(page.getByText(requester.name).first()).toBeVisible()
}

/** Ends the session, for a spec that needs to become somebody else. */
export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login$/)
}

/**
 * ui-spec.md §8: no unintended horizontal scroll at any width.
 *
 * Asserted on every screen at every viewport rather than once — the table on
 * My Tickets and the attachment rows on Ticket Detail are far likelier to
 * overflow than the stacked form, so checking only one screen would test the
 * safest case and miss the risky ones.
 */
export async function expectNoHorizontalScroll(page: Page, viewportWidth: number) {
  // Offenders first: a bare "scrolls by 48px" says nothing about what to fix.
  const widest = await page.evaluate((limit) => {
    const offenders: string[] = []
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.right > limit + 1) {
        offenders.push(`${el.tagName.toLowerCase()}.${el.className || '(no class)'}`)
      }
    }
    return offenders.slice(0, 5)
  }, viewportWidth)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )

  // Names the element rather than only failing, so a regression is actionable.
  expect(widest, `elements extend past ${viewportWidth}px`).toEqual([])
  expect(overflow, 'page scrolls horizontally').toBeLessThanOrEqual(0)
}
