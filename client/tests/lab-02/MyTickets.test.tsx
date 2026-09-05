import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../src/App'
import { REQUESTER_STORAGE_KEY } from '../../src/requester/requesterContext'

// UI-04, UI-10, UI-11 (ui-spec.md §6.3). Rendered through <App /> at /tickets
// so the route guard, shell and screen are exercised together.

const REQUESTER = { id: 1, name: 'Peter Parker', email: 'peter.parker@toktickit.test' }
const OTHER = { id: 2, name: 'Ned Leeds', email: 'ned.leeds@toktickit.test' }

const CATEGORIES = [
  { id: 10, name: 'Hardware', description: 'Devices' },
  { id: 11, name: 'Software', description: 'Applications' },
]

function ticket(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    ticketNumber: `TKT-2026-${String(id).padStart(6, '0')}`,
    summary: `Ticket ${id} summary`,
    categoryName: 'Hardware',
    requestedPriority: 'MEDIUM',
    currentStatus: 'NEW',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
    ...overrides,
  }
}

function listResponse(
  data: ReturnType<typeof ticket>[],
  extra: {
    filtered?: boolean
    page?: number
    pageSize?: number
    totalItems?: number
    totalPages?: number
  } = {},
) {
  // pageSize defaults to the data length so the "Showing X–Y of Z" arithmetic
  // stays coherent with whatever totalPages the caller asks for.
  const pageSize = extra.pageSize ?? Math.max(data.length, 1)
  const totalItems = extra.totalItems ?? data.length
  return {
    data,
    pagination: {
      page: extra.page ?? 1,
      pageSize,
      totalItems,
      totalPages: extra.totalPages ?? Math.ceil(totalItems / pageSize),
    },
    filtered: extra.filtered ?? false,
  }
}

/** Captures the ticket-list query strings the screen actually requested. */
const requestedQueries: string[] = []

function mockApi(listFor: (url: URL) => unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
    const raw = String(input)
    if (raw.includes('/api/categories')) return Promise.resolve(Response.json(CATEGORIES))
    if (raw.includes('/api/requesters')) {
      return Promise.resolve(Response.json([REQUESTER, OTHER]))
    }
    if (raw.includes('/api/tickets')) {
      const url = new URL(raw, 'http://localhost')
      requestedQueries.push(url.search)
      return Promise.resolve(Response.json(listFor(url)))
    }
    return Promise.resolve(Response.json([]))
  }) as typeof fetch)
}

function renderList() {
  window.history.pushState({}, '', '/tickets')
  return render(<App />)
}

describe('My Tickets', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    requestedQueries.length = 0
    window.localStorage.clear()
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, JSON.stringify(REQUESTER))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('UI-04 (AC-02): redirects to the Selector when no Requester is selected', async () => {
    window.localStorage.clear()
    mockApi(() => listResponse([]))

    renderList()

    expect(
      await screen.findByRole('combobox', { name: /Development Requester/i }),
    ).toBeInTheDocument()
    expect(window.location.pathname).toBe('/select-requester')
  })

  it('AC-11: lists the Tickets the API returned, scoped by requesterId', async () => {
    mockApi(() => listResponse([ticket(1), ticket(2)]))

    renderList()

    expect(await screen.findByText('TKT-2026-000001')).toBeInTheDocument()
    expect(screen.getByText('TKT-2026-000002')).toBeInTheDocument()
    // Ownership is the server's job; the client must at least ask correctly.
    expect(requestedQueries[0]).toContain('requesterId=1')
  })

  it('UI-10 (AC-14): shows the Empty state, with no filter toolbar', async () => {
    mockApi(() => listResponse([], { filtered: false }))

    renderList()

    expect(await screen.findByText(/haven't created any tickets yet/i)).toBeInTheDocument()
    // A filter toolbar here would imply data exists somewhere to filter.
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
    expect(screen.queryByText(/No tickets match your filters/i)).not.toBeInTheDocument()
  })

  it('UI-10 (AC-13): shows the No-Results state, distinct from Empty', async () => {
    mockApi(() => listResponse([], { filtered: true }))

    renderList()

    expect(await screen.findByText(/No tickets match your filters/i)).toBeInTheDocument()
    expect(screen.queryByText(/haven't created any tickets yet/i)).not.toBeInTheDocument()
    // The toolbar stays so the filters can actually be cleared.
    expect(screen.getByRole('search')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Clear Filters/i }).length).toBeGreaterThan(0)
  })

  it('AC-33: sends the search term and reloads', async () => {
    const user = userEvent.setup()
    mockApi((url) =>
      url.searchParams.get('search')
        ? listResponse([ticket(7, { summary: 'VPN keeps dropping' })], { filtered: true })
        : listResponse([ticket(1), ticket(2)]),
    )

    renderList()
    await screen.findByText('TKT-2026-000001')

    await user.type(screen.getByLabelText(/^Search/), 'VPN')
    await user.click(screen.getByRole('button', { name: /^Apply$/ }))

    expect(await screen.findByText('VPN keeps dropping')).toBeInTheDocument()
    expect(requestedQueries.some((q) => q.includes('search=VPN'))).toBe(true)
  })

  it('AC-30: combines Category and Priority filters in one request', async () => {
    const user = userEvent.setup()
    mockApi(() => listResponse([ticket(1)]))

    renderList()
    await screen.findByText('TKT-2026-000001')

    await user.selectOptions(screen.getByLabelText(/^Category/), '11')
    await user.selectOptions(screen.getByLabelText(/^Requested Priority/), 'HIGH')
    await user.click(screen.getByRole('button', { name: /^Apply$/ }))

    await waitFor(() => {
      const last = requestedQueries[requestedQueries.length - 1]
      expect(last).toContain('categoryId=11')
      expect(last).toContain('requestedPriority=HIGH')
    })
  })

  it('Clear Filters resets the controls and refetches unfiltered', async () => {
    const user = userEvent.setup()
    mockApi((url) =>
      url.searchParams.get('search')
        ? listResponse([], { filtered: true })
        : listResponse([ticket(1)]),
    )

    renderList()
    await screen.findByText('TKT-2026-000001')

    await user.type(screen.getByLabelText(/^Search/), 'nothing')
    await user.click(screen.getByRole('button', { name: /^Apply$/ }))
    await screen.findByText(/No tickets match your filters/i)

    await user.click(screen.getAllByRole('button', { name: /Clear Filters/i })[0])

    expect(await screen.findByText('TKT-2026-000001')).toBeInTheDocument()
    expect((screen.getByLabelText(/^Search/) as HTMLInputElement).value).toBe('')
  })

  it('UI-11 (AC-15): pages forward without repeating rows', async () => {
    const user = userEvent.setup()
    mockApi((url) => {
      const page = Number(url.searchParams.get('page') ?? '1')
      return listResponse([ticket(page === 1 ? 1 : 2)], {
        page,
        totalItems: 2,
        totalPages: 2,
      })
    })

    renderList()
    await screen.findByText('TKT-2026-000001')
    expect(screen.getByText(/Showing 1–1 of 2/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Next$/ }))

    expect(await screen.findByText('TKT-2026-000002')).toBeInTheDocument()
    expect(screen.queryByText('TKT-2026-000001')).not.toBeInTheDocument()
  })

  it('disables Previous on the first page and Next on the last', async () => {
    mockApi(() => listResponse([ticket(1)], { page: 1, totalItems: 2, totalPages: 2 }))

    renderList()
    await screen.findByText('TKT-2026-000001')

    expect(screen.getByRole('button', { name: /^Previous$/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Next$/ })).toBeEnabled()
  })

  it('AC-16: sorting by a column requests it and reports the direction', async () => {
    const user = userEvent.setup()
    mockApi(() => listResponse([ticket(1)]))

    renderList()
    await screen.findByText('TKT-2026-000001')

    await user.click(screen.getByRole('button', { name: /Requested Priority/i }))

    await waitFor(() => {
      const last = requestedQueries[requestedQueries.length - 1]
      expect(last).toContain('sortBy=requestedPriority')
      expect(last).toContain('sortDir=desc')
    })

    // A second click flips direction rather than re-sorting the same way.
    await user.click(screen.getByRole('button', { name: /Requested Priority/i }))
    await waitFor(() => {
      expect(requestedQueries[requestedQueries.length - 1]).toContain('sortDir=asc')
    })

    const header = screen
      .getAllByRole('columnheader')
      .find((th) => within(th).queryByRole('button', { name: /Requested Priority/i }))
    expect(header).toHaveAttribute('aria-sort', 'ascending')
  })

  it('FR-07: keeps a sort control outside the table, for widths where it is hidden', async () => {
    const user = userEvent.setup()
    mockApi(() => listResponse([ticket(1)]))

    renderList()
    await screen.findByText('TKT-2026-000001')

    // Under 768px the table — and every sort button in its header — is
    // display:none, so a control that lives outside it is the only thing
    // keeping sorting reachable on a phone.
    // Re-query the toolbar each time rather than holding a `within` handle:
    // the form remounts across these updates, which detaches the old node.
    const toolbar = () => within(screen.getByRole('search'))

    expect(toolbar().getByLabelText(/Sort by/i)).toBeInTheDocument()

    await user.selectOptions(toolbar().getByLabelText(/Sort by/i), 'requestedPriority')
    await waitFor(() => {
      expect(requestedQueries[requestedQueries.length - 1]).toContain(
        'sortBy=requestedPriority',
      )
    })

    await user.click(toolbar().getByText(/^(Descending|Ascending)$/))
    await waitFor(() => {
      expect(requestedQueries[requestedQueries.length - 1]).toContain('sortDir=asc')
    })
  })

  it('renders both priority and status badges with their text label', async () => {
    mockApi(() => listResponse([ticket(1, { requestedPriority: 'HIGH' })]))

    renderList()
    await screen.findByText('TKT-2026-000001')

    // Scoped to the table: the mobile card list renders the same rows, and
    // jsdom applies no CSS, so both copies are present here.
    const table = within(screen.getByRole('table'))
    // ui-spec.md §7: colour is never the only signal.
    expect(table.getByText('High')).toBeInTheDocument()
    expect(table.getByText('New')).toBeInTheDocument()
  })

  it('shows a retryable failure state when the list cannot load', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'))

    renderList()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Unable to load your Tickets/i)
    expect(alert).not.toHaveTextContent(/Failed to fetch/)
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
  })

  it('AC-12: switching Requester reloads for the new one and drops the old filters', async () => {
    const user = userEvent.setup()
    mockApi((url) =>
      url.searchParams.get('requesterId') === '2'
        ? listResponse([ticket(9, { summary: "Ned's ticket" })])
        : listResponse([ticket(1)]),
    )

    renderList()
    await screen.findByText('TKT-2026-000001')

    await user.type(screen.getByLabelText(/^Search/), 'stale term')
    await user.click(screen.getByRole('button', { name: /^Apply$/ }))
    await waitFor(() => {
      expect(requestedQueries.some((q) => q.includes('search=stale'))).toBe(true)
    })

    // Simulate the selector storing a different Requester and remounting.
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, JSON.stringify(OTHER))
    window.history.pushState({}, '', '/tickets')
    render(<App />)

    expect(await screen.findByText("Ned's ticket")).toBeInTheDocument()
    const last = requestedQueries[requestedQueries.length - 1]
    expect(last).toContain('requesterId=2')
    expect(last).not.toContain('search=stale')
  })
})
