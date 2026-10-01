import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'

// UI-08 and UI-09 (AC-13, AC-08, FR-05), ui-spec.md §2.

let signedIn: ReturnType<typeof authUser> | null = authUser()
const logoutCalls: string[] = []

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(((
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input)
    if (url.includes('/api/auth/logout')) {
      logoutCalls.push(String(init?.method))
      signedIn = null
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    const auth = authRoutes(signedIn)(url)
    return auth ?? Promise.resolve(Response.json([]))
  }) as typeof fetch)
}

const nav = () => screen.getByRole('navigation', { name: 'Primary' })
const navLabels = () =>
  within(nav())
    .getAllByRole('link')
    .map((link) => link.textContent)

beforeEach(() => {
  vi.restoreAllMocks()
  logoutCalls.length = 0
  signedIn = authUser()
  window.history.pushState({}, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('UI-08 role-specific navigation (AC-13, FR-05)', () => {
  it('shows a Requester their own destinations and nobody else’s', async () => {
    signedIn = authUser({ role: 'REQUESTER', name: 'Peter Parker' })
    mockApi()
    await renderApp()

    expect(navLabels()).toEqual(['My Tickets', 'Create Ticket'])
    // Not rendered at all, rather than rendered and disabled: a disabled link
    // to a place you can never go is an invitation (ui-spec.md §2).
    expect(screen.queryByRole('link', { name: 'Ticket Queue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'User Management' })).not.toBeInTheDocument()

    expect(screen.getByText('Peter Parker')).toBeInTheDocument()
    expect(screen.getByText('Requester')).toBeInTheDocument()
  })

  it('shows IT Staff the queue only', async () => {
    signedIn = authUser({ role: 'IT_STAFF', name: 'Sarah Chen' })
    mockApi()
    await renderApp()

    expect(navLabels()).toEqual(['Ticket Queue'])
    expect(screen.getByText('IT Staff')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My Tickets' })).not.toBeInTheDocument()
  })

  it('shows an Administrator the queue and user management', async () => {
    signedIn = authUser({ role: 'ADMINISTRATOR', name: 'Alex Morgan' })
    mockApi()
    await renderApp()

    expect(navLabels()).toEqual(['Ticket Queue', 'User Management'])
    expect(screen.getByText('Administrator')).toBeInTheDocument()
  })

  it('refuses a route the role may not reach, with a reason and a way onward', async () => {
    signedIn = authUser({ role: 'REQUESTER' })
    mockApi()
    window.history.pushState({}, '', '/admin/users')
    await renderApp()

    // A Forbidden state, not a silent bounce: a redirect looks like a broken
    // link and teaches the person nothing (ui-spec.md §2).
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/do not have permission/i)
    expect(screen.getByRole('link', { name: /home page/i })).toBeInTheDocument()
  })
})

describe('a session that goes away mid-use (review of PR #53)', () => {
  it('sends the user to Login instead of leaving them on a failure state', async () => {
    // The screen loads normally, then the session expires or an Administrator
    // deactivates the account, and the next call answers 401.
    let sessionAlive = true
    vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
      const url = String(input)
      const auth = authRoutes(signedIn)(url)
      if (auth) return auth
      if (url.includes('/api/tickets')) {
        return Promise.resolve(
          sessionAlive
            ? Response.json({
                data: [],
                filtered: false,
                pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 },
              })
            : Response.json({ error: 'Authentication required' }, { status: 401 }),
        )
      }
      return Promise.resolve(Response.json([]))
    }) as typeof fetch)

    window.history.pushState({}, '', '/tickets')
    await renderApp()
    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument()

    sessionAlive = false
    await userEvent.setup().click(screen.getByRole('link', { name: 'Create Ticket' }))
    await userEvent.setup().click(screen.getByRole('link', { name: 'My Tickets' }))

    await waitFor(() => expect(window.location.pathname).toBe('/login'))
    expect(await screen.findByRole('heading', { name: /Sign in/i })).toBeInTheDocument()
  })

  it('does not mistake a failed login for an expired session', async () => {
    // A 401 from the auth endpoints is ordinary: a wrong password, or nobody
    // signed in yet. Neither may clear state the caller is already handling.
    signedIn = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/login')) {
        return Promise.resolve(
          Response.json({ error: 'Invalid email or password' }, { status: 401 }),
        )
      }
      const auth = authRoutes(signedIn)(url)
      return auth ?? Promise.resolve(Response.json([]))
    }) as typeof fetch)

    window.history.pushState({}, '', '/login')
    await renderApp()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Email address/i), 'peter.parker@toktickit.test')
    await user.type(screen.getByLabelText(/^Password/i), 'wrong')
    await user.click(screen.getByRole('button', { name: /Sign in/i }))

    // Still on Login, showing the login error rather than having been "signed
    // out" of a session that never existed.
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.')
    expect(window.location.pathname).toBe('/login')
  })
})

describe('UI-09 logout (AC-08)', () => {
  it('ends the session, returns to Login, and leaves protected routes closed', async () => {
    mockApi()
    await renderApp()

    await userEvent.setup().click(screen.getByRole('button', { name: /Log out/i }))

    await waitFor(() => expect(window.location.pathname).toBe('/login'))
    expect(logoutCalls).toEqual(['POST'])

    // The shell is gone with the session — a nav the person can no longer use
    // would read as "logout is broken".
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /Sign in/i })).toBeInTheDocument()
  })

  it('sends someone with no session to Login instead of the app', async () => {
    signedIn = null
    mockApi()
    window.history.pushState({}, '', '/tickets')
    await renderApp()

    expect(await screen.findByRole('heading', { name: /Sign in/i })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
  })
})
