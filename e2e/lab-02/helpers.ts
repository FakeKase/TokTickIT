import { expect } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

export const API = 'http://localhost:3001'

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
export async function firstRequester(request: APIRequestContext): Promise<SeedRequester> {
  const response = await request.get(`${API}/api/requesters`)
  expect(response.ok(), 'GET /api/requesters must succeed — is the database seeded?').toBe(true)
  const requesters = (await response.json()) as SeedRequester[]
  expect(requesters.length, 'seed must provide at least one active Requester').toBeGreaterThan(0)
  return requesters[0]
}

/** A second Requester, for the states that need an account with no Tickets. */
export async function secondRequester(request: APIRequestContext): Promise<SeedRequester> {
  const response = await request.get(`${API}/api/requesters`)
  const requesters = (await response.json()) as SeedRequester[]
  expect(requesters.length).toBeGreaterThan(1)
  return requesters[1]
}

/**
 * Written into every Ticket this suite creates, however it is created, so the
 * teardown can find them all. server/src/scripts/e2e-cleanup.ts filters on the
 * same string, and a spec asserts the two still match.
 *
 * A Ticket submitted through the form counts too: it is a real row in the same
 * database, and one that skips this marker leaks on every run.
 */
export const FIXTURE_MARKER = 'Lab 2 walkthrough'

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
  requesterId: number,
  overrides: Record<string, unknown> = {},
) {
  const [categories, systems] = await Promise.all([
    request.get(`${API}/api/categories`).then((r) => r.json()),
    request.get(`${API}/api/related-systems`).then((r) => r.json()),
  ])

  const response = await request.post(`${API}/api/tickets`, {
    data: {
      requesterId,
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
  requesterId: number,
  name = 'evidence.png',
) {
  const response = await request.post(`${API}/api/tickets/${ticketId}/attachments`, {
    multipart: {
      requesterId: String(requesterId),
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

/**
 * Puts the app in the "Requester already selected" state.
 *
 * Writes the same localStorage key the app uses rather than clicking through
 * the selector, so a failure in these specs points at the screen under test
 * rather than at the selection flow.
 */
export async function selectRequester(page: Page, requester: SeedRequester) {
  await page.addInitScript((value) => {
    window.localStorage.setItem('toktickit.selectedRequester', value)
  }, JSON.stringify(requester))
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
