import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuthenticatedUser, Role } from '../../src/api'
import { canRoleOpen, landingPathFor } from '../../src/auth/landing'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'
import { hrefOf, requesterDashboard, staffDashboard } from './dashboardFixtures'

// UI-25 (Lab 4 FR-13, AC-40; ui-spec.md §1).

let signedIn: AuthenticatedUser | null

function mockApi(onLogin?: () => AuthenticatedUser) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
    const url = String(input)
    if (onLogin && url.includes('/api/auth/login')) {
      signedIn = onLogin()
      return Promise.resolve(Response.json({ user: signedIn }))
    }
    const auth = authRoutes(signedIn)(url)
    if (auth) return auth
    if (url.includes('/api/dashboard/requester')) return Promise.resolve(Response.json(requesterDashboard()))
    if (url.includes('/api/dashboard/staff')) return Promise.resolve(Response.json(staffDashboard()))
    if (url.includes('/api/health')) return Promise.resolve(Response.json({ status: 'ok', service: 'TokTickIT API' }))
    if (/\/api\/(staff\/)?tickets(\?|$)/.test(url)) {
      return Promise.resolve(
        Response.json({ data: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 }, filtered: false }),
      )
    }
    return Promise.resolve(Response.json([]))
  }) as typeof fetch)
}

const nav = () => within(screen.getByRole('navigation', { name: 'Primary' }))
const navLabels = () => nav().getAllByRole('link').map((link) => link.textContent)
const currentItems = () =>
  nav()
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent)

async function renderAt(path: string) {
  window.history.pushState({}, '', path)
  await renderApp()
  await screen.findByRole('navigation', { name: 'Primary' })
}

const USERS: Record<Role, AuthenticatedUser> = {
  REQUESTER: authUser({ id: 1, name: 'Peter Parker', role: 'REQUESTER' }),
  IT_STAFF: authUser({ id: 9, name: 'Sarah Chen', role: 'IT_STAFF' }),
  ADMINISTRATOR: authUser({ id: 3, name: 'Alex Morgan', role: 'ADMINISTRATOR' }),
}

const EXPECTED: Record<Role, { landing: string; items: string[]; heading: string }> = {
  REQUESTER: {
    landing: '/dashboard',
    items: ['Dashboard', 'My Tickets', 'Create Ticket'],
    heading: 'Welcome, Peter',
  },
  IT_STAFF: {
    landing: '/staff/dashboard',
    items: ['Dashboard', 'Ticket Queue'],
    heading: 'Welcome back, Sarah',
  },
  ADMINISTRATOR: {
    landing: '/staff/dashboard',
    items: ['Dashboard', 'Ticket Queue', 'User Management', 'System Status'],
    heading: 'Welcome back, Alex',
  },
}

const ROLES = Object.keys(EXPECTED) as Role[]

beforeEach(() => {
  vi.restoreAllMocks()
  signedIn = null
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('UI-25 navigation (FR-13)', () => {
  it.each(ROLES)('puts Dashboard first for %s and renders only what the role may open', async (role) => {
    signedIn = USERS[role]
    mockApi()
    await renderAt(EXPECTED[role].landing)

    expect(navLabels()).toEqual(EXPECTED[role].items)
    expect(hrefOf(nav().getByRole('link', { name: 'Dashboard' }))).toBe(EXPECTED[role].landing)
  })

  it.each(ROLES)('marks Dashboard, and only Dashboard, current on its own route for %s', async (role) => {
    signedIn = USERS[role]
    mockApi()
    await renderAt(EXPECTED[role].landing)

    expect(currentItems()).toEqual(['Dashboard'])
  })

  it.each([
    ['REQUESTER', '/tickets', 'My Tickets'],
    ['REQUESTER', '/tickets/new', 'Create Ticket'],
    ['IT_STAFF', '/staff/tickets', 'Ticket Queue'],
    ['ADMINISTRATOR', '/staff/tickets', 'Ticket Queue'],
    ['ADMINISTRATOR', '/admin/users', 'User Management'],
    ['ADMINISTRATOR', '/system-status', 'System Status'],
  ] as const)('marks exactly one item current for %s on %s', async (role, path, item) => {
    signedIn = USERS[role]
    mockApi()
    await renderAt(path)

    expect(currentItems()).toEqual([item])
  })

  it.each(ROLES)('points the wordmark at the landing route for %s', async (role) => {
    signedIn = USERS[role]
    mockApi()
    await renderAt(EXPECTED[role].landing)

    expect(hrefOf(screen.getByRole('link', { name: 'TokTickIT' }))).toBe(EXPECTED[role].landing)
  })
})

describe('UI-25 landing (AC-40)', () => {
  it.each(ROLES)('leads %s from / to their Dashboard', async (role) => {
    signedIn = USERS[role]
    mockApi()
    await renderAt('/')

    await waitFor(() => expect(window.location.pathname).toBe(EXPECTED[role].landing))
    expect(await screen.findByRole('heading', { name: EXPECTED[role].heading })).toBeInTheDocument()
  })

  it.each(ROLES)('leads %s from an address that is not a screen to their Dashboard', async (role) => {
    signedIn = USERS[role]
    mockApi()
    await renderAt('/no/such/page')

    await waitFor(() => expect(window.location.pathname).toBe(EXPECTED[role].landing))
  })

  it.each(ROLES)('lands %s on their Dashboard after signing in', async (role) => {
    mockApi(() => USERS[role])
    window.history.pushState({}, '', '/login')
    await renderApp()

    const user = userEvent.setup()
    await user.type(await screen.findByLabelText(/Email address/i), 'someone@toktickit.test')
    await user.type(screen.getByLabelText(/^Password/i), 'ChangeMe123!')
    await user.click(screen.getByRole('button', { name: /Sign in/i }))

    await waitFor(() => expect(window.location.pathname).toBe(EXPECTED[role].landing))
    expect(await screen.findByRole('heading', { name: EXPECTED[role].heading })).toBeInTheDocument()
  })

  it('names one landing route per role, and counts each Dashboard as somewhere that role can go', () => {
    for (const role of ROLES) {
      expect(landingPathFor(role)).toBe(EXPECTED[role].landing)
      expect(canRoleOpen(role, EXPECTED[role].landing)).toBe(true)
    }
    // A remembered destination is followed only when the new user may open it.
    expect(canRoleOpen('REQUESTER', '/staff/dashboard')).toBe(false)
    expect(canRoleOpen('IT_STAFF', '/dashboard')).toBe(false)
    expect(canRoleOpen('IT_STAFF', '/system-status')).toBe(false)
    expect(canRoleOpen('ADMINISTRATOR', '/system-status')).toBe(true)
    expect(canRoleOpen('ADMINISTRATOR', '/dashboard')).toBe(false)
  })
})
