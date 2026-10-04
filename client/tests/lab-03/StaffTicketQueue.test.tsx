import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { StaffQueueItem } from '../../src/api'
import { formatRelative } from '../../src/pages/relativeTime'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'

// UI-10 to UI-13 (AC-22, AC-23, AC-24, AC-26, AC-44; BR-30, BR-31).
//
// The table and the mobile cards are both in the DOM here - jsdom applies no
// media queries - so anything asserted about "a row" is asserted inside the
// table, the way My Tickets' tests do it.

let signedIn = authUser({ id: 9, name: 'Sarah Chen', role: 'IT_STAFF' })

const ticket = (id: number, overrides: Partial<StaffQueueItem> = {}): StaffQueueItem => ({
  id,
  ticketNumber: `TKT-2026-${String(id).padStart(6, '0')}`,
  summary: `Summary of ticket ${id}`,
  category: { id: 10, name: 'Hardware' },
  requester: { id: 1, name: 'Peter Parker' },
  owner: null,
  requestedPriority: 'LOW',
  itPriority: 'MEDIUM',
  currentStatus: 'NEW',
  requesterResolvedAt: null,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  ...overrides,
})

const page = (
  data: StaffQueueItem[],
  overrides: { filtered?: boolean; pagination?: Record<string, number> } = {},
) => ({
  data,
  pagination: {
    page: 1,
    pageSize: 10,
    totalItems: data.length,
    totalPages: data.length ? 1 : 0,
    ...overrides.pagination,
  },
  filtered: overrides.filtered ?? false,
})

/** Every queue request the screen made, as its query parameters. */
let requests: URLSearchParams[] = []

type QueueHandler = (query: URLSearchParams) => Promise<Response> | Response

function mockApi(queue: QueueHandler = () => Response.json(page([ticket(1)]))) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
    const url = String(input)
    const auth = authRoutes(signedIn)(url)
    if (auth) return auth

    if (url.includes('/api/staff/tickets')) {
      const query = new URL(url, 'http://localhost').searchParams
      requests.push(query)
      return Promise.resolve(queue(query))
    }
    if (url.includes('/api/categories')) {
      return Promise.resolve(
        Response.json([
          { id: 10, name: 'Hardware', description: '' },
          { id: 11, name: 'Software', description: '' },
        ]),
      )
    }
    return Promise.resolve(Response.json([]))
  }) as typeof fetch)
}

const openQueue = async (path = '/staff/tickets') => {
  window.history.pushState({}, '', path)
  await renderApp()
  await screen.findByRole('heading', { name: 'Ticket Queue' })
}

const table = async () => within(await screen.findByRole('table'))
const lastRequest = () => Object.fromEntries(requests[requests.length - 1])

beforeEach(() => {
  vi.restoreAllMocks()
  signedIn = authUser({ id: 9, name: 'Sarah Chen', role: 'IT_STAFF' })
  requests = []
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('UI-10 the queue renders rows (AC-22, FR-13)', () => {
  it('shows number, summary, both priorities, status and owner for each Ticket', async () => {
    mockApi(() =>
      Response.json(
        page([
          ticket(41, {
            summary: 'Laptop will not start',
            requestedPriority: 'HIGH',
            itPriority: 'URGENT',
            currentStatus: 'IN_PROGRESS',
            owner: { id: 9, name: 'Sarah Chen' },
          }),
          ticket(42, { summary: 'Printer offline' }),
        ]),
      ),
    )
    await openQueue()

    const rows = (await table()).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)

    const first = within(rows[0])
    expect(first.getByRole('link', { name: 'TKT-2026-000041' })).toHaveAttribute(
      'href',
      '/staff/tickets/41',
    )
    expect(first.getByText('Laptop will not start')).toBeInTheDocument()
    // By column, because the two priorities are only meaningful as a pair:
    // what was asked for beside what IT decided, each under its own header.
    // Looking for "High" anywhere in the row would be satisfied by the copy
    // the Summary cell carries for tablets.
    const headers = (await table()).getAllByRole('columnheader').map((th) => th.textContent)
    const cell = (name: string) =>
      first.getAllByRole('cell')[headers.findIndex((header) => header?.startsWith(name))]
    expect(cell('Requested')).toHaveTextContent('High')
    expect(cell('IT Priority')).toHaveTextContent('Urgent')
    expect(cell('Status')).toHaveTextContent('In Progress')
    expect(cell('Owner')).toHaveTextContent('Sarah Chen')
    expect(cell('Category')).toHaveTextContent('Hardware')

    expect(within(rows[1]).getByText('Unassigned')).toBeInTheDocument()
  })

  it('does not put the Requester in a column', async () => {
    mockApi()
    await openQueue()

    // ui-spec.md §4: triage runs on priority, status and ownership.
    expect((await table()).queryByText('Peter Parker')).toBeNull()
    expect(screen.queryByRole('columnheader', { name: /requester/i })).toBeNull()
  })

  it('spells every status as words, never as the enum', async () => {
    mockApi(() =>
      Response.json(
        page([
          ticket(1, { currentStatus: 'WAITING_FOR_REQUESTER' }),
          ticket(2, { currentStatus: 'CANCELLED' }),
          ticket(3, { currentStatus: 'RESOLVED' }),
        ]),
      ),
    )
    await openQueue()

    const view = await table()
    expect(view.getByText('Waiting for Requester')).toBeInTheDocument()
    expect(view.getByText('Cancelled')).toBeInTheDocument()
    expect(view.getByText('Resolved')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/WAITING_FOR|Waiting_for/)
  })

  it('shows Last Updated as a distance, with the full time behind it', async () => {
    const updatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    mockApi(() => Response.json(page([ticket(1, { updatedAt })])))
    await openQueue()

    const time = (await table()).getByText('2h ago')
    expect(time).toHaveAttribute('datetime', updatedAt)
    expect(time.getAttribute('title')).toBeTruthy()
  })

  it('asks for the default view with nothing but sort and page', async () => {
    mockApi()
    await openQueue()
    await table()

    // BR-31, and no empty filter parameters sent along for the ride.
    expect(lastRequest()).toEqual({ sortBy: 'updatedAt', sortDir: 'desc', page: '1' })
  })
})

describe('UI-11 empty and no-results are different states (AC-23)', () => {
  it('says the queue is empty, with nothing to clear and no controls', async () => {
    mockApi(() => Response.json(page([])))
    await openQueue()

    expect(await screen.findByText('No Tickets in the queue yet.')).toBeInTheDocument()
    expect(screen.queryByText(/match these filters/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull()
    expect(screen.queryByRole('search')).toBeNull()
  })

  it('says nothing matched, keeps the controls, and offers a way out', async () => {
    mockApi((query) =>
      Response.json(query.get('search') ? page([], { filtered: true }) : page([ticket(1)])),
    )
    await openQueue('/staff/tickets?search=nothing-like-this')

    expect(await screen.findByText('No Tickets match these filters.')).toBeInTheDocument()
    expect(screen.queryByText(/in the queue yet/i)).toBeNull()
    expect(screen.getByRole('search')).toBeInTheDocument()

    // Both Clear buttons do the same thing; the one in the message is the
    // one the eye is on.
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: /clear filters/i })[0])

    await table()
    expect(lastRequest().search).toBeUndefined()
    expect(screen.getByLabelText('Search')).toHaveValue('')
  })
})

describe('UI-12 filters, sorting and paging (AC-24, AC-26, BR-30)', () => {
  it('refetches with both filters when status and IT Priority are set together', async () => {
    mockApi()
    await openQueue()
    await table()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Status'), 'IN_PROGRESS')
    await user.selectOptions(screen.getByLabelText('IT Priority'), 'HIGH')

    await waitFor(() =>
      expect(lastRequest()).toMatchObject({ status: 'IN_PROGRESS', itPriority: 'HIGH' }),
    )
  })

  it('sends the owner and category filters', async () => {
    mockApi()
    await openQueue()
    await table()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Owner'), 'unassigned')
    await waitFor(() => expect(lastRequest().owner).toBe('unassigned'))

    await user.selectOptions(await screen.findByLabelText('Category'), '11')
    await waitFor(() => expect(lastRequest().categoryId).toBe('11'))

    await user.selectOptions(screen.getByLabelText('Owner'), 'me')
    await waitFor(() => expect(lastRequest().owner).toBe('me'))
  })

  it('searches on submit, trimmed, and not on every keystroke', async () => {
    mockApi()
    await openQueue()
    await table()
    const before = requests.length

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search'), '  printer  ')
    expect(requests.length).toBe(before)

    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(lastRequest().search).toBe('printer'))
    // Trimmed before it reaches the address bar, not just before the request.
    expect(window.location.search).toBe('?search=printer')
  })

  it('applies search text that was typed but not submitted when another filter changes', async () => {
    mockApi()
    await openQueue()
    await table()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search'), 'printer')
    await user.selectOptions(screen.getByLabelText('Status'), 'OPEN')

    // The box says "printer", so the queue must be showing "printer". Leaving
    // it out would put text on screen that the results do not reflect.
    await waitFor(() => expect(lastRequest()).toMatchObject({ search: 'printer', status: 'OPEN' }))
  })

  it('returns to page 1 when paging would otherwise carry unsubmitted search text', async () => {
    mockApi((query) =>
      Response.json(
        page([ticket(1)], {
          pagination: { page: Number(query.get('page') ?? 1), pageSize: 1, totalItems: 3, totalPages: 3 },
        }),
      ),
    )
    await openQueue()
    await table()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search'), 'vpn')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // A different search is a different set, so "page 2" of the old one
    // means nothing in it.
    await waitFor(() => expect(lastRequest()).toMatchObject({ search: 'vpn', page: '1' }))
  })

  it('empties the search box on Clear filters even when that text was never applied', async () => {
    mockApi()
    await openQueue('/staff/tickets?status=NEW')
    await table()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search'), 'never submitted')
    await user.click(screen.getByRole('button', { name: /clear filters/i }))

    await waitFor(() => expect(lastRequest().status).toBeUndefined())
    expect(lastRequest().search).toBeUndefined()
    expect(screen.getByLabelText('Search')).toHaveValue('')
  })

  it('offers Clear filters only while a filter is active', async () => {
    mockApi()
    await openQueue()
    await table()
    expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Status'), 'NEW')

    await user.click(await screen.findByRole('button', { name: /clear filters/i }))
    await waitFor(() => expect(lastRequest().status).toBeUndefined())
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull(),
    )
  })

  it('counts the active filters on the mobile toggle', async () => {
    mockApi()
    await openQueue('/staff/tickets?status=NEW&owner=me')
    await table()

    // By text, not by role: the toggle is display:none above 767px and jsdom
    // sits at that base rule, so it has no accessible name to look up here -
    // which is right, because at this width the controls are simply there.
    expect(screen.getByText('Filters (2)')).toHaveAttribute('aria-expanded', 'false')
  })

  it('sorts from a column header, and reverses on a second click', async () => {
    mockApi()
    await openQueue()

    const user = userEvent.setup()
    await user.click((await table()).getByRole('button', { name: /IT Priority/ }))
    await waitFor(() =>
      expect(lastRequest()).toMatchObject({ sortBy: 'itPriority', sortDir: 'desc' }),
    )

    await user.click((await table()).getByRole('button', { name: /IT Priority/ }))
    await waitFor(() => expect(lastRequest().sortDir).toBe('asc'))
    expect(
      (await table()).getByRole('columnheader', { name: /IT Priority/ }),
    ).toHaveAttribute('aria-sort', 'ascending')
  })

  it('starts a newly chosen sort key descending, from the select as from a header', async () => {
    mockApi()
    await openQueue('/staff/tickets?sortBy=ticketNumber&sortDir=asc')
    await table()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Sort by'), 'itPriority')

    // Carrying "ascending" over from Ticket Number would open IT Priority on
    // Low, which is the wrong end of a triage list.
    await waitFor(() =>
      expect(lastRequest()).toMatchObject({ sortBy: 'itPriority', sortDir: 'desc' }),
    )
  })

  it('offers Created Date as a sort although it has no column', async () => {
    mockApi()
    await openQueue()
    await table()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Sort by'), 'createdAt')

    await waitFor(() => expect(lastRequest().sortBy).toBe('createdAt'))
    expect(screen.queryByRole('columnheader', { name: /created/i })).toBeNull()
  })

  it('moves between pages and stops at both ends', async () => {
    mockApi((query) => {
      const current = Number(query.get('page') ?? 1)
      return Response.json(
        page([ticket(current)], {
          pagination: { page: current, pageSize: 1, totalItems: 3, totalPages: 3 },
        }),
      )
    })
    await openQueue()
    await table()

    const user = userEvent.setup()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByText('Showing 1–1 of 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Showing 2–2 of 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Showing 3–3 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('goes back to page 1 when a filter changes', async () => {
    mockApi((query) =>
      Response.json(
        page([ticket(1)], {
          pagination: { page: Number(query.get('page') ?? 1), pageSize: 1, totalItems: 5, totalPages: 5 },
        }),
      ),
    )
    await openQueue('/staff/tickets?page=3')
    await table()
    expect(lastRequest().page).toBe('3')

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Status'), 'OPEN')

    await waitFor(() => expect(lastRequest()).toMatchObject({ status: 'OPEN', page: '1' }))
  })

  it('corrects the address bar when the page asked for was clamped', async () => {
    // Two pages exist. Whatever is asked for past the end, the server serves
    // page 2 and says so (AC-26).
    mockApi((query) => {
      const served = Math.min(Number(query.get('page') ?? 1), 2)
      return Response.json(
        page([ticket(served)], {
          pagination: { page: served, pageSize: 1, totalItems: 2, totalPages: 2 },
        }),
      )
    })
    await openQueue('/staff/tickets?page=9')
    await table()

    expect(screen.getByText('Showing 2–2 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    // A link copied from here must not carry a page that does not exist.
    expect(window.location.search).toBe('?page=2')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    await waitFor(() => expect(lastRequest().page).toBe('1'))
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it('corrects the address bar to the plain queue when a paged view turns out empty', async () => {
    mockApi(() => Response.json(page([])))
    await openQueue('/staff/tickets?page=7')

    expect(await screen.findByText('No Tickets in the queue yet.')).toBeInTheDocument()
    expect(window.location.search).toBe('')
  })
})

describe('the view lives in the address bar', () => {
  it('restores filters, sort and page from the URL', async () => {
    // A server that really has a page 2, so the view is not corrected back.
    mockApi(() =>
      Response.json(
        page([ticket(1)], {
          filtered: true,
          pagination: { page: 2, pageSize: 1, totalItems: 2, totalPages: 2 },
        }),
      ),
    )
    await openQueue(
      '/staff/tickets?search=vpn&status=OPEN&itPriority=URGENT&owner=me&sortBy=itPriority&sortDir=asc&page=2',
    )
    await table()

    expect(lastRequest()).toEqual({
      search: 'vpn',
      status: 'OPEN',
      itPriority: 'URGENT',
      owner: 'me',
      sortBy: 'itPriority',
      sortDir: 'asc',
      page: '2',
    })
    expect(screen.getByLabelText('Search')).toHaveValue('vpn')
    expect(screen.getByLabelText('Status')).toHaveValue('OPEN')
    expect(screen.getByLabelText('Owner')).toHaveValue('me')
  })

  it('writes a filter into the URL, so Back from a Ticket returns to the same view', async () => {
    mockApi()
    await openQueue()
    await table()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('IT Priority'), 'URGENT')

    await waitFor(() => expect(window.location.search).toBe('?itPriority=URGENT'))
  })

  it('ignores values it does not recognise instead of sending them on', async () => {
    mockApi()
    await openQueue('/staff/tickets?status=ARCHIVED&owner=7&sortBy=passwordHash&page=-2')
    await table()

    expect(lastRequest()).toEqual({ sortBy: 'updatedAt', sortDir: 'desc', page: '1' })
  })
})

describe('UI-13 failure, forbidden and loading (AC-44, AC-14)', () => {
  it('renders a safe failure with a Retry that refetches', async () => {
    let fail = true
    mockApi(() =>
      fail
        ? Response.json({ error: 'relation "Ticket" does not exist' }, { status: 500 })
        : Response.json(page([ticket(7)])),
    )
    await openQueue()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to load the Ticket Queue')
    // Whatever the server said stays with the server.
    expect(alert).not.toHaveTextContent(/relation|does not exist/)

    fail = false
    const user = userEvent.setup()
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))

    expect((await table()).getByText('TKT-2026-000007')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('fails safely when the API cannot be reached at all', async () => {
    mockApi(() => Promise.reject(new TypeError('Failed to fetch')))
    await openQueue()

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load the Ticket Queue')
  })

  it('shows Forbidden, not Retry, when the API refuses the role', async () => {
    // The route guard believed the session's role; the API is the authority.
    mockApi(() => Response.json({ error: 'Forbidden' }, { status: 403 }))
    await openQueue()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/do not have permission/i)
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(within(alert).getByRole('link', { name: /home page/i })).toBeInTheDocument()
  })

  it('never requests the queue for a Requester', async () => {
    signedIn = authUser({ role: 'REQUESTER' })
    mockApi()
    window.history.pushState({}, '', '/staff/tickets')
    await renderApp()

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not have permission/i)
    expect(screen.queryByRole('heading', { name: 'Ticket Queue' })).toBeNull()
    expect(requests).toHaveLength(0)
  })

  it('lets an Administrator in', async () => {
    signedIn = authUser({ id: 2, name: 'Ada Admin', role: 'ADMINISTRATOR' })
    mockApi()
    await openQueue()

    expect((await table()).getByText('TKT-2026-000001')).toBeInTheDocument()
  })

  it('announces loading while the request is out', async () => {
    let release: (response: Response) => void = () => {}
    mockApi(() => new Promise<Response>((resolve) => (release = resolve)))
    await openQueue()

    expect(screen.getByRole('status')).toHaveTextContent('Loading the Ticket Queue')
    expect(screen.queryByRole('table')).toBeNull()

    release(Response.json(page([ticket(1)])))
    await table()
    expect(screen.queryByText('Loading the Ticket Queue…')).toBeNull()
  })

  it('keeps the newest answer when an older request lands late', async () => {
    const pending: Record<string, (response: Response) => void> = {}
    mockApi((query) => {
      const status = query.get('status') ?? 'none'
      return new Promise<Response>((resolve) => (pending[status] = resolve))
    })
    await openQueue()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Status'), 'NEW')
    await waitFor(() => expect(pending.NEW).toBeDefined())
    await user.selectOptions(screen.getByLabelText('Status'), 'OPEN')
    await waitFor(() => expect(pending.OPEN).toBeDefined())

    // The newer request answers first, then the two older ones straggle in.
    pending.OPEN(Response.json(page([ticket(2, { summary: 'the open one' })], { filtered: true })))
    expect((await table()).getByText('the open one')).toBeInTheDocument()

    pending.NEW(Response.json(page([ticket(3, { summary: 'the stale one' })], { filtered: true })))
    pending.none(Response.json(page([ticket(4, { summary: 'the first one' })])))
    await new Promise((resolve) => setTimeout(resolve, 20))

    const view = await table()
    expect(view.getByText('the open one')).toBeInTheDocument()
    expect(view.queryByText('the stale one')).toBeNull()
    expect(view.queryByText('the first one')).toBeNull()
  })
})

describe('relative time', () => {
  const now = Date.UTC(2026, 8, 10, 12, 0, 0)
  const ago = (ms: number) => formatRelative(new Date(now - ms).toISOString(), now)
  const MIN = 60_000

  it('steps from minutes to hours to days at the boundaries', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(59_999)).toBe('just now')
    expect(ago(MIN)).toBe('1m ago')
    expect(ago(59 * MIN)).toBe('59m ago')
    expect(ago(60 * MIN)).toBe('1h ago')
    expect(ago(23 * 60 * MIN)).toBe('23h ago')
    expect(ago(24 * 60 * MIN)).toBe('1d ago')
    expect(ago(29 * 24 * 60 * MIN)).toBe('29d ago')
  })

  it('gives the date once the distance stops meaning anything', () => {
    expect(ago(30 * 24 * 60 * MIN)).not.toMatch(/ago/)
    expect(ago(30 * 24 * 60 * MIN)).toMatch(/2026/)
  })

  it('reads a timestamp from the future as now, not as a negative distance', () => {
    expect(ago(-5 * MIN)).toBe('just now')
  })
})
