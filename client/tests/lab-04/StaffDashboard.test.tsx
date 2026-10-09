import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuthenticatedUser, StaffDashboard } from '../../src/api'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'
import { hrefOf, staffDashboard } from './dashboardFixtures'

// UI-16 to UI-20 (Lab 4 FR-10 to FR-12; BR-27, BR-29; AC-32, AC-33, AC-35, AC-41).
//
// The screen is given a response and asked what it drew. Whether the numbers
// are right is the server's business and is tested there; what is tested here
// is that the screen shows what it was sent and links where it was told to.

let signedIn: AuthenticatedUser
let dashboardCalls = 0

type Answer = () => Promise<Response> | Response

function mockApi(answer: Answer = () => Response.json(staffDashboard())) {
  dashboardCalls = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
    const url = String(input)
    const auth = authRoutes(signedIn)(url)
    if (auth) return auth
    if (url.includes('/api/dashboard/staff')) {
      dashboardCalls += 1
      return Promise.resolve(answer())
    }
    return Promise.resolve(Response.json([]))
  }) as typeof fetch)
}

async function open(body?: StaffDashboard) {
  mockApi(body ? () => Response.json(body) : undefined)
  window.history.pushState({}, '', '/staff/dashboard')
  await renderApp()
  await screen.findByTestId('by-status')
}

beforeEach(() => {
  vi.restoreAllMocks()
  signedIn = authUser({ id: 9, name: 'Sarah Chen', role: 'IT_STAFF' })
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('UI-16 staff metric cards (FR-10, AC-33)', () => {
  it('greets the user by first name', async () => {
    await open()

    expect(screen.getByRole('heading', { name: 'Welcome back, Sarah' })).toBeInTheDocument()
  })

  it('shows each count under its label, as a link to the queue with the served query', async () => {
    await open()

    for (const [name, href] of [
      ['Unassigned, 2, view all', '/staff/tickets?owner=unassigned&status=ACTIVE'],
      ['My Tickets, 4, view all', '/staff/tickets?owner=me&status=ACTIVE'],
      ['Urgent, 1, view all', '/staff/tickets?itPriority=URGENT&status=ACTIVE'],
    ]) {
      expect(hrefOf(screen.getByRole('link', { name }))).toBe(href)
    }
    expect(screen.getByTestId('metric-unassigned-value')).toHaveTextContent(/^2$/)
  })

  it('links wherever the response says, not where this screen expects', async () => {
    const body = staffDashboard()
    body.metrics[0] = { key: 'unassigned', value: 6, query: 'owner=unassigned&status=NEW' }
    await open(body)

    expect(hrefOf(screen.getByRole('link', { name: 'Unassigned, 6, view all' }))).toBe(
      '/staff/tickets?owner=unassigned&status=NEW',
    )
  })

  it('shows My Actions Today as plain text: a count, its day, and no link', async () => {
    await open()

    const card = screen.getByTestId('metric-myActionsToday')
    expect(card).toHaveTextContent('My Actions Today')
    expect(within(card).getByTestId('metric-myActionsToday-value')).toHaveTextContent(/^3$/)
    expect(card).toHaveTextContent('Bangkok time')
    expect(card.tagName).not.toBe('A')
    expect(within(card).queryByRole('link')).not.toBeInTheDocument()
    expect(card).not.toHaveTextContent('View all')
  })

  it('shows zero as 0', async () => {
    const body = staffDashboard()
    body.metrics = body.metrics.map((metric) => ({ ...metric, value: 0 }))
    await open(body)

    for (const key of ['unassigned', 'myTickets', 'urgent', 'myActionsToday']) {
      expect(screen.getByTestId(`metric-${key}-value`)).toHaveTextContent(/^0$/)
    }
    expect(screen.getByRole('link', { name: 'Unassigned, 0, view all' })).toBeInTheDocument()
  })
})

describe('UI-17 Tickets by Status (FR-10)', () => {
  it('lists all eight statuses in the served order, each a link to the queue for it', async () => {
    await open()

    const links = within(screen.getByTestId('by-status')).getAllByRole('link')

    expect(links.map(hrefOf)).toEqual([
      '/staff/tickets?status=NEW',
      '/staff/tickets?status=OPEN',
      '/staff/tickets?status=IN_PROGRESS',
      '/staff/tickets?status=WAITING_FOR_REQUESTER',
      '/staff/tickets?status=RESOLVED',
      '/staff/tickets?status=CLOSED',
      '/staff/tickets?status=REOPENED',
      '/staff/tickets?status=CANCELLED',
    ])
  })

  it('names each row by its status in words and its count, zero included', async () => {
    await open()

    const card = within(screen.getByTestId('by-status'))
    expect(card.getByRole('link', { name: 'In Progress, 7, view all' })).toBeInTheDocument()
    const open0 = card.getByRole('link', { name: 'Open, 0, view all' })
    expect(open0).toHaveTextContent('Open')
    expect(open0).toHaveTextContent('0')
    expect(card.getByRole('link', { name: 'Waiting for Requester, 1, view all' })).toBeInTheDocument()
  })
})

describe('UI-18 staff lists (FR-10, BR-27)', () => {
  it('links each recently updated Ticket to its staff detail, with its badges and owner', async () => {
    await open()

    const list = within(screen.getByTestId('list-recently-updated'))
    const rows = list.getAllByRole('listitem')

    expect(rows).toHaveLength(2)
    expect(hrefOf(within(rows[0]).getByRole('link'))).toBe('/staff/tickets/42')
    expect(rows[0]).toHaveTextContent('TKT-2026-000042')
    expect(rows[0]).toHaveTextContent('In Progress')
    expect(rows[0]).toHaveTextContent('Urgent')
    expect(rows[0]).toHaveTextContent('Sarah Chen')
    expect(rows[1]).toHaveTextContent('Unassigned')
    // The Summary is one truncated line; the whole of it is still reachable.
    expect(within(rows[0]).getByTitle('Projector in LX-204 will not power on')).toBeInTheDocument()
  })

  it('links each of my Actions Taken to that Ticket’s Actions Taken area', async () => {
    await open()

    const rows = within(screen.getByTestId('list-my-actions')).getAllByRole('listitem')

    expect(hrefOf(within(rows[0]).getByRole('link'))).toBe('/staff/tickets/42#actions-taken')
    expect(rows[0]).toHaveTextContent('Replaced the projector lamp in LX-204.')
    expect(rows[0]).toHaveTextContent('Follow-up required')
    expect(hrefOf(within(rows[1]).getByRole('link'))).toBe('/staff/tickets/40#actions-taken')
    expect(rows[1]).not.toHaveTextContent('Follow-up required')
  })

  it('shows each empty list as its own line, not as a missing section', async () => {
    await open(staffDashboard({ recentlyUpdated: [], myRecentActions: [] }))

    const updated = screen.getByTestId('list-recently-updated')
    const actions = screen.getByTestId('list-my-actions')
    expect(within(updated).getByRole('heading', { name: 'Recently updated Tickets' })).toBeInTheDocument()
    expect(updated).toHaveTextContent('No Tickets yet.')
    expect(within(actions).getByRole('heading', { name: 'My recent Actions Taken' })).toBeInTheDocument()
    expect(actions).toHaveTextContent('You have not recorded any Actions Taken yet.')
    expect(within(updated).queryByRole('listitem')).not.toBeInTheDocument()
  })
})

describe('UI-19 user accounts card (BR-29, AC-35)', () => {
  it('shows an Administrator both counts and a link to User Management', async () => {
    signedIn = authUser({ id: 3, name: 'Alex Morgan', role: 'ADMINISTRATOR' })
    await open(staffDashboard({ users: { active: 9, inactive: 2 } }))

    const card = within(screen.getByTestId('user-accounts'))
    expect(card.getByRole('heading', { name: 'User accounts' })).toBeInTheDocument()
    expect(card.getByTestId('users-active')).toHaveTextContent(/^9$/)
    expect(card.getByTestId('users-inactive')).toHaveTextContent(/^2$/)
    expect(hrefOf(card.getByRole('link'))).toBe('/admin/users')
  })

  it('shows IT Staff no card and no placeholder for one', async () => {
    await open()

    expect(screen.queryByTestId('user-accounts')).not.toBeInTheDocument()
    expect(screen.queryByText('User accounts')).not.toBeInTheDocument()
    expect(screen.queryByText(/Inactive/)).not.toBeInTheDocument()
  })

  it('draws the card from the response, so an Administrator sent no counts sees none', async () => {
    signedIn = authUser({ id: 3, name: 'Alex Morgan', role: 'ADMINISTRATOR' })
    await open()

    expect(screen.queryByTestId('user-accounts')).not.toBeInTheDocument()
  })
})

describe('UI-20 staff dashboard states (AC-32, AC-41)', () => {
  it('shows a loading state until the response arrives', async () => {
    let release: (response: Response) => void = () => {}
    mockApi(() => new Promise<Response>((resolve) => (release = resolve)))
    window.history.pushState({}, '', '/staff/dashboard')
    await renderApp()

    expect(await screen.findByText('Loading the dashboard…')).toBeInTheDocument()
    expect(screen.queryByTestId('by-status')).not.toBeInTheDocument()

    release(Response.json(staffDashboard()))
    expect(await screen.findByTestId('by-status')).toBeInTheDocument()
    expect(screen.queryByText('Loading the dashboard…')).not.toBeInTheDocument()
  })

  it.each([
    ['a server error', () => Response.json({ error: 'Unable to load the dashboard' }, { status: 500 })],
    ['no connection', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a body that is not a dashboard', () => Response.json([])],
  ])('shows a failure with a retry and no numbers after %s', async (_what, answer) => {
    mockApi(answer as Answer)
    window.history.pushState({}, '', '/staff/dashboard')
    await renderApp()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to load the dashboard')
    expect(screen.queryByTestId('metric-unassigned')).not.toBeInTheDocument()
    expect(screen.queryByTestId('by-status')).not.toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('loads again when Try again is pressed', async () => {
    let attempt = 0
    mockApi(() =>
      ++attempt === 1 ? Response.json({ error: 'x' }, { status: 500 }) : Response.json(staffDashboard()),
    )
    window.history.pushState({}, '', '/staff/dashboard')
    await renderApp()

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('by-status')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(dashboardCalls).toBe(2)
  })

  it('shows a Requester the Forbidden state with a link to their own Dashboard, and asks for nothing', async () => {
    signedIn = authUser({ role: 'REQUESTER' })
    mockApi()
    window.history.pushState({}, '', '/staff/dashboard')
    await renderApp()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/do not have permission/i)
    expect(hrefOf(within(alert).getByRole('link'))).toBe('/dashboard')
    expect(dashboardCalls).toBe(0)
  })

  it('shows Forbidden, with no retry, when the server refuses', async () => {
    mockApi(() => Response.json({ error: 'You do not have permission to perform this action' }, { status: 403 }))
    window.history.pushState({}, '', '/staff/dashboard')
    await renderApp()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/do not have permission/i)
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('by-status')).not.toBeInTheDocument()
  })
})
