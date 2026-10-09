import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuthenticatedUser, RequesterDashboard } from '../../src/api'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'
import { emptyRequesterDashboard, hrefOf, requesterDashboard } from './dashboardFixtures'

// UI-21 to UI-24 (Lab 4 FR-09, FR-12; BR-27; AC-30 to AC-32, AC-41).

let signedIn: AuthenticatedUser
let dashboardUrls: string[] = []

type Answer = () => Promise<Response> | Response

function mockApi(answer: Answer = () => Response.json(requesterDashboard())) {
  dashboardUrls = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
    const url = String(input)
    const auth = authRoutes(signedIn)(url)
    if (auth) return auth
    if (url.includes('/api/dashboard/requester')) {
      dashboardUrls.push(url)
      return Promise.resolve(answer())
    }
    return Promise.resolve(Response.json([]))
  }) as typeof fetch)
}

async function open(body?: RequesterDashboard) {
  mockApi(body ? () => Response.json(body) : undefined)
  window.history.pushState({}, '', '/dashboard')
  await renderApp()
  await screen.findByTestId('metric-openTickets')
}

beforeEach(() => {
  vi.restoreAllMocks()
  signedIn = authUser({ id: 1, name: 'Peter Parker', role: 'REQUESTER' })
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('UI-21 Requester metric cards (FR-09, AC-30)', () => {
  it('greets the Requester and offers Create Ticket', async () => {
    await open()

    expect(screen.getByRole('heading', { name: 'Welcome, Peter' })).toBeInTheDocument()
    expect(screen.getByText('Here is the latest on your Tickets.')).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Create Ticket' }))
    await waitFor(() => expect(window.location.pathname).toBe('/tickets/new'))
  })

  it('shows four cards, each a link to My Tickets with the served query', async () => {
    await open()

    for (const [name, href] of [
      ['Open Tickets, 3, view all', '/tickets?status=ACTIVE'],
      ['Waiting for You, 1, view all', '/tickets?status=WAITING_FOR_REQUESTER'],
      ['Resolved, 0, view all', '/tickets?status=RESOLVED'],
      ['Closed, 4, view all', '/tickets?status=CLOSED'],
    ]) {
      expect(hrefOf(screen.getByRole('link', { name }))).toBe(href)
    }
    expect(screen.getByTestId('metric-resolved-value')).toHaveTextContent(/^0$/)
  })

  it('asks for the dashboard with no parameter and no id of its own', async () => {
    await open()

    expect(dashboardUrls).toHaveLength(1)
    expect(dashboardUrls[0]).toMatch(/\/api\/dashboard\/requester$/)
  })
})

describe('UI-22 Requester lists (FR-09)', () => {
  it('renders each list’s rows as links to the Ticket', async () => {
    await open()

    const attention = within(screen.getByTestId('list-needs-attention'))
    const updated = within(screen.getByTestId('list-recently-updated'))
    const resolved = within(screen.getByTestId('list-recently-resolved'))

    expect(attention.getByRole('heading', { name: 'Needs your attention' })).toBeInTheDocument()
    expect(attention.getAllByRole('listitem')).toHaveLength(1)
    expect(hrefOf(within(attention.getByRole('listitem')).getByRole('link'))).toBe('/tickets/42')
    expect(attention.getByRole('listitem')).toHaveTextContent('Waiting for Requester')

    expect(updated.getAllByRole('listitem').map((row) => hrefOf(within(row).getByRole('link')))).toEqual([
      '/tickets/44',
      '/tickets/42',
    ])

    const resolvedRow = resolved.getByRole('listitem')
    expect(hrefOf(within(resolvedRow).getByRole('link'))).toBe('/tickets/40')
    expect(resolvedRow).toHaveTextContent('TKT-2026-000040')
    expect(resolvedRow).toHaveTextContent('Closed')
    // Dated by when it was resolved, not by when it was last touched.
    expect(within(resolvedRow).getByText(/Resolved /).closest('time')).toHaveAttribute(
      'datetime',
      '2026-10-03T03:00:00.000Z',
    )
  })

  it('marks Needs your attention only while there is something in it', async () => {
    await open()
    expect(screen.getByTestId('list-needs-attention')).toHaveClass('ttk-dash-list--attention')
  })

  it('offers View all on the two lists that have somewhere to lead', async () => {
    await open()

    expect(hrefOf(screen.getByRole('link', { name: 'View all: Needs your attention' }))).toBe(
      '/tickets?status=WAITING_FOR_REQUESTER',
    )
    expect(hrefOf(screen.getByRole('link', { name: 'View all: Recently updated' }))).toBe(
      '/tickets?sortBy=updatedAt',
    )
    expect(screen.queryByRole('link', { name: 'View all: Recently resolved' })).not.toBeInTheDocument()
  })

  it('shows each empty list as its own line', async () => {
    await open(requesterDashboard({ needsAttention: [], recentlyResolved: [] }))

    const attention = screen.getByTestId('list-needs-attention')
    expect(attention).toHaveTextContent('Nothing is waiting for you.')
    expect(attention).not.toHaveClass('ttk-dash-list--attention')
    expect(screen.getByTestId('list-recently-resolved')).toHaveTextContent(
      'Nothing was resolved in the last 7 days.',
    )
    expect(within(screen.getByTestId('list-recently-updated')).getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('UI-23 empty account (BR-27, AC-31)', () => {
  it('shows four zeros, one empty state with Create Ticket, and no lists', async () => {
    await open(emptyRequesterDashboard())

    for (const key of ['openTickets', 'waitingForYou', 'resolved', 'closed']) {
      expect(screen.getByTestId(`metric-${key}-value`)).toHaveTextContent(/^0$/)
    }
    expect(screen.getByRole('heading', { name: 'You have not created any Tickets yet' })).toBeInTheDocument()
    expect(screen.queryByTestId('list-needs-attention')).not.toBeInTheDocument()
    expect(screen.queryByTestId('list-recently-updated')).not.toBeInTheDocument()
    expect(screen.queryByTestId('list-recently-resolved')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // One beside the heading and one in the empty state.
    expect(screen.getAllByRole('button', { name: 'Create Ticket' })).toHaveLength(2)
  })
  it('keeps the lists for a Requester whose only Ticket is counted by no card', async () => {
    // A Cancelled Ticket is in none of the four counts, but the account is not
    // empty and the Ticket has to be reachable from here.
    const body = emptyRequesterDashboard()
    body.recentlyUpdated = [
      {
        id: 50,
        ticketNumber: 'TKT-2026-000050',
        summary: 'Raised by mistake',
        currentStatus: 'CANCELLED',
        updatedAt: '2026-10-06T03:00:00.000Z',
      },
    ]
    await open(body)

    expect(screen.queryByRole('heading', { name: 'You have not created any Tickets yet' })).not.toBeInTheDocument()
    expect(within(screen.getByTestId('list-recently-updated')).getByRole('listitem')).toHaveTextContent(
      'TKT-2026-000050',
    )
    expect(screen.getByTestId('list-needs-attention')).toHaveTextContent('Nothing is waiting for you.')
  })
})

describe('UI-24 Requester dashboard states (AC-32, AC-41)', () => {
  it('shows a loading state until the response arrives', async () => {
    let release: (response: Response) => void = () => {}
    mockApi(() => new Promise<Response>((resolve) => (release = resolve)))
    window.history.pushState({}, '', '/dashboard')
    await renderApp()

    expect(await screen.findByText('Loading your dashboard…')).toBeInTheDocument()
    expect(screen.queryByTestId('metric-openTickets')).not.toBeInTheDocument()

    release(Response.json(requesterDashboard()))
    expect(await screen.findByTestId('metric-openTickets')).toBeInTheDocument()
  })

  it('shows a failure with a retry and no numbers, then recovers', async () => {
    let attempt = 0
    mockApi(() =>
      ++attempt === 1 ? Promise.reject(new TypeError('Failed to fetch')) : Response.json(requesterDashboard()),
    )
    window.history.pushState({}, '', '/dashboard')
    await renderApp()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to load your dashboard')
    expect(screen.queryByTestId('metric-openTickets')).not.toBeInTheDocument()

    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('metric-openTickets')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each(['IT_STAFF', 'ADMINISTRATOR'] as const)(
    'shows %s the Forbidden state with a link to their own Dashboard, and asks for nothing',
    async (role) => {
      signedIn = authUser({ id: 9, name: 'Sarah Chen', role })
      mockApi()
      window.history.pushState({}, '', '/dashboard')
      await renderApp()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/do not have permission/i)
      expect(hrefOf(within(alert).getByRole('link'))).toBe('/staff/dashboard')
      expect(dashboardUrls).toHaveLength(0)
    },
  )
})
