import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuthenticatedUser } from '../../src/api'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'

// UI-26 and UI-27 (Lab 4 FR-12, AC-37, AC-39; ui-spec.md §5).
//
// A dashboard count is only as good as the list it opens. These are about the
// receiving end: the list reads its view from the address, shows it in its
// controls, and writes every change back.

let signedIn: AuthenticatedUser
/** Every list request made, as its query parameters. */
let requests: URLSearchParams[] = []

const row = (id: number) => ({
  id,
  ticketNumber: `TKT-2026-${String(id).padStart(6, '0')}`,
  summary: `Ticket ${id} summary`,
  categoryName: 'Hardware',
  category: { id: 10, name: 'Hardware' },
  requester: { id: 1, name: 'Peter Parker' },
  owner: null,
  requestedPriority: 'MEDIUM',
  itPriority: 'MEDIUM',
  currentStatus: 'OPEN',
  requesterResolvedAt: null,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-02T09:00:00.000Z',
})

interface ListOptions {
  rows?: number
  totalItems?: number
  totalPages?: number
}

function mockApi(list: (query: URLSearchParams) => ListOptions = () => ({})) {
  requests = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
    const url = String(input)
    const auth = authRoutes(signedIn)(url)
    if (auth) return auth
    if (url.includes('/api/categories')) {
      return Promise.resolve(
        Response.json([
          { id: 10, name: 'Hardware', description: '' },
          { id: 11, name: 'Software', description: '' },
        ]),
      )
    }
    if (/\/api\/(staff\/)?tickets(\?|$)/.test(url)) {
      const query = new URL(url, 'http://localhost').searchParams
      requests.push(query)
      const { rows = 2, totalItems = rows, totalPages = rows ? 1 : 0 } = list(query)
      const filtered = ['search', 'status', 'categoryId', 'requestedPriority', 'itPriority', 'owner'].some(
        (key) => query.has(key),
      )
      return Promise.resolve(
        Response.json({
          data: Array.from({ length: rows }, (_, index) => row(index + 1)),
          pagination: { page: Number(query.get('page') ?? 1), pageSize: 10, totalItems, totalPages },
          filtered,
        }),
      )
    }
    return Promise.resolve(Response.json([]))
  }) as typeof fetch)
}

const lastRequest = () => Object.fromEntries(requests[requests.length - 1])
const address = () => `${window.location.pathname}${window.location.search}`

async function openMyTickets(path = '/tickets') {
  signedIn = authUser({ id: 1, name: 'Peter Parker', role: 'REQUESTER' })
  window.history.pushState({}, '', path)
  await renderApp()
  await screen.findByRole('heading', { name: 'My Tickets' })
  await waitFor(() => expect(requests.length).toBeGreaterThan(0))
  await screen.findByRole('table')
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('UI-26 My Tickets view in the URL (FR-12, AC-37)', () => {
  it('applies a status from the address and shows it selected', async () => {
    mockApi()
    await openMyTickets('/tickets?status=ACTIVE')

    expect(lastRequest()).toMatchObject({ status: 'ACTIVE' })
    expect(screen.getByLabelText('Status')).toHaveValue('ACTIVE')
    expect(within(screen.getByLabelText('Status')).getByRole('option', { name: 'Active' })).toHaveProperty(
      'selected',
      true,
    )
  })

  it('offers All Statuses, Active, then the eight statuses', async () => {
    mockApi()
    await openMyTickets()

    const options = within(screen.getByLabelText('Status')).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'All Statuses',
      'Active',
      'New',
      'Open',
      'In Progress',
      'Waiting for Requester',
      'Resolved',
      'Closed',
      'Reopened',
      'Cancelled',
    ])
  })

  it('reads every part of the view from the address', async () => {
    mockApi(() => ({ rows: 2, totalItems: 25, totalPages: 3 }))
    await openMyTickets(
      '/tickets?search=printer&status=RESOLVED&categoryId=11&requestedPriority=HIGH&sortBy=updatedAt&sortDir=asc&page=2',
    )

    expect(lastRequest()).toEqual({
      search: 'printer',
      status: 'RESOLVED',
      categoryId: '11',
      requestedPriority: 'HIGH',
      sortBy: 'updatedAt',
      sortDir: 'asc',
      page: '2',
    })
    expect(screen.getByLabelText('Search')).toHaveValue('printer')
    expect(screen.getByLabelText('Status')).toHaveValue('RESOLVED')
    expect(screen.getByLabelText('Requested Priority')).toHaveValue('HIGH')
    await waitFor(() => expect(screen.getByLabelText('Category')).toHaveValue('11'))
    expect(screen.getByRole('columnheader', { name: /Last Updated/ })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('ignores what it does not recognise, as the API does', async () => {
    mockApi()
    await openMyTickets('/tickets?status=BOGUS&sortBy=password&page=-3&requestedPriority=URGENT')

    expect(lastRequest()).toEqual({ sortBy: 'createdAt', sortDir: 'desc', page: '1' })
    expect(screen.getByLabelText('Status')).toHaveValue('')
  })

  it('writes an applied filter to the address, and not before Apply', async () => {
    mockApi()
    await openMyTickets()
    const user = userEvent.setup()

    await user.selectOptions(screen.getByLabelText('Status'), 'WAITING_FOR_REQUESTER')
    expect(address()).toBe('/tickets')
    expect(requests).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(address()).toBe('/tickets?status=WAITING_FOR_REQUESTER'))
    await waitFor(() => expect(lastRequest()).toMatchObject({ status: 'WAITING_FOR_REQUESTER' }))
  })

  it('writes the sort to the address, and Last Updated is a sortable column', async () => {
    mockApi()
    await openMyTickets('/tickets?status=ACTIVE')
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Last Updated/ }))
    await waitFor(() => expect(address()).toBe('/tickets?status=ACTIVE&sortBy=updatedAt'))
    expect(lastRequest()).toMatchObject({ status: 'ACTIVE', sortBy: 'updatedAt', sortDir: 'desc' })

    await user.click(screen.getByRole('button', { name: /Last Updated/ }))
    await waitFor(() => expect(address()).toBe('/tickets?status=ACTIVE&sortBy=updatedAt&sortDir=asc'))
  })

  it('offers Last Updated in the Sort by select used on mobile', async () => {
    mockApi()
    await openMyTickets()

    await userEvent.setup().selectOptions(screen.getByLabelText('Sort by'), 'updatedAt')

    await waitFor(() => expect(address()).toBe('/tickets?sortBy=updatedAt'))
  })

  it('writes the page to the address, and a new filter goes back to page 1', async () => {
    mockApi(() => ({ rows: 2, totalItems: 25, totalPages: 3 }))
    await openMyTickets('/tickets?status=ACTIVE')
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(address()).toBe('/tickets?status=ACTIVE&page=2'))
    await waitFor(() => expect(lastRequest()).toMatchObject({ page: '2' }))

    await user.selectOptions(screen.getByLabelText('Requested Priority'), 'LOW')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(address()).toBe('/tickets?status=ACTIVE&requestedPriority=LOW'))
  })

  it('empties the address on Clear Filters, keeping the sort', async () => {
    mockApi()
    await openMyTickets('/tickets?status=CLOSED&search=printer&sortBy=updatedAt')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear Filters' }))

    await waitFor(() => expect(address()).toBe('/tickets?sortBy=updatedAt'))
    expect(screen.getByLabelText('Status')).toHaveValue('')
    expect(screen.getByLabelText('Search')).toHaveValue('')
    await waitFor(() => expect(lastRequest()).toEqual({ sortBy: 'updatedAt', sortDir: 'desc', page: '1' }))
  })

  it('shows No-Results with Clear Filters for a filter that arrived in a link', async () => {
    mockApi(() => ({ rows: 0 }))
    signedIn = authUser({ id: 1, role: 'REQUESTER' })
    window.history.pushState({}, '', '/tickets?status=RESOLVED')
    await renderApp()

    expect(await screen.findByRole('heading', { name: 'No tickets match your filters' })).toBeInTheDocument()
    // The toolbar stays, with the filter that produced nothing shown in it.
    expect(screen.getByLabelText('Status')).toHaveValue('RESOLVED')

    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Clear Filters' })[0])
    await waitFor(() => expect(address()).toBe('/tickets'))
  })

  it('follows the address when it changes under the screen, as Back does', async () => {
    mockApi()
    await openMyTickets('/tickets?status=ACTIVE')

    window.history.pushState({}, '', '/tickets?status=CLOSED')
    window.dispatchEvent(new PopStateEvent('popstate'))

    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('CLOSED'))
    await waitFor(() => expect(lastRequest()).toMatchObject({ status: 'CLOSED' }))
  })
})

describe('UI-27 Ticket Queue Active filter (FR-12, AC-37)', () => {
  async function openQueue(path: string) {
    signedIn = authUser({ id: 9, name: 'Sarah Chen', role: 'IT_STAFF' })
    window.history.pushState({}, '', path)
    await renderApp()
    await screen.findByRole('heading', { name: 'Ticket Queue' })
    await waitFor(() => expect(requests.length).toBeGreaterThan(0))
  }

  it('offers Active straight after All statuses', async () => {
    mockApi()
    await openQueue('/staff/tickets')

    const options = within(screen.getByLabelText('Status')).getAllByRole('option')
    expect(options.slice(0, 3).map((option) => option.textContent)).toEqual(['All statuses', 'Active', 'New'])
    expect(options).toHaveLength(10)
  })

  it.each([
    ['owner=unassigned&status=ACTIVE', { owner: 'unassigned', status: 'ACTIVE' }],
    ['owner=me&status=ACTIVE', { owner: 'me', status: 'ACTIVE' }],
    ['itPriority=URGENT&status=ACTIVE', { itPriority: 'URGENT', status: 'ACTIVE' }],
  ])('applies the dashboard link %s and shows Active selected', async (query, expected) => {
    mockApi()
    await openQueue(`/staff/tickets?${query}`)

    expect(lastRequest()).toMatchObject(expected)
    expect(screen.getByLabelText('Status')).toHaveValue('ACTIVE')
  })

  it('sends Active when it is chosen by hand, and writes it to the address', async () => {
    mockApi()
    await openQueue('/staff/tickets')

    await userEvent.setup().selectOptions(screen.getByLabelText('Status'), 'ACTIVE')

    await waitFor(() => expect(address()).toBe('/staff/tickets?status=ACTIVE'))
    await waitFor(() => expect(lastRequest()).toMatchObject({ status: 'ACTIVE' }))
  })
})
