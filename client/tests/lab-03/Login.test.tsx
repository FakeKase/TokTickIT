import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'

// UI-01 to UI-04 (AC-01, AC-06, AC-07, AC-44), ui-spec.md §1.1.

const TICKET_DETAIL = {
  id: 42,
  ticketNumber: 'TKT-2026-000042',
  requester: { id: 1, name: 'Peter Parker' },
  category: { id: 10, name: 'Hardware' },
  relatedSystem: { id: 20, name: 'Corporate Laptop' },
  summary: 'Laptop will not start',
  description: 'Nothing happens when the power button is pressed.',
  requestedPriority: 'MEDIUM',
  currentStatus: 'NEW',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  attachments: [],
}

let signedIn: ReturnType<typeof authUser> | null = null

/** Answers /api/auth/login with `respond`, and everything else emptily. */
function mockApi(respond: (body: { email: string; password: string }) => Response) {
  const calls: { email: string; password: string }[] = []

  vi.spyOn(globalThis, 'fetch').mockImplementation(((
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input)
    const auth = authRoutes(signedIn)(url)
    if (auth) return auth

    if (url.includes('/api/auth/login')) {
      const body = JSON.parse(String(init?.body)) as { email: string; password: string }
      calls.push(body)
      return Promise.resolve(respond(body))
    }
    // The resume test lands on a Ticket Detail route, which throws on an
    // answer it cannot read — leaving an unhandled error behind a passing test.
    if (/\/api\/tickets\/\d+/.test(url)) return Promise.resolve(Response.json(TICKET_DETAIL))
    return Promise.resolve(Response.json([]))
  }) as typeof fetch)

  return calls
}

const fillAndSubmit = async (email: string, password: string) => {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/Email address/i), email)
  await user.type(screen.getByLabelText(/^Password/i), password)
  await user.click(screen.getByRole('button', { name: /Sign in/i }))
}

beforeEach(() => {
  vi.restoreAllMocks()
  signedIn = null
  window.history.pushState({}, '', '/login')
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('UI-01 Login (AC-01)', () => {
  it('signs in and lands on the role home page', async () => {
    const calls = mockApi(() => Response.json({ user: authUser() }))
    await renderApp()

    await fillAndSubmit('peter.parker@toktickit.test', 'ChangeMe123!')

    await waitFor(() => expect(window.location.pathname).toBe('/tickets'))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      email: 'peter.parker@toktickit.test',
      password: 'ChangeMe123!',
    })
  })

  it('sends IT Staff and Administrators to their own landing pages', async () => {
    for (const [role, path] of [
      ['IT_STAFF', '/staff/tickets'],
      ['ADMINISTRATOR', '/admin/users'],
    ] as const) {
      vi.restoreAllMocks()
      window.history.pushState({}, '', '/login')
      mockApi(() => Response.json({ user: authUser({ role }) }))
      await renderApp()

      await fillAndSubmit('someone@toktickit.test', 'ChangeMe123!')

      await waitFor(() => expect(window.location.pathname).toBe(path))
    }
  })

  it('sends a user holding an initial password to Change Password first (AC-02)', async () => {
    mockApi(() => Response.json({ user: authUser({ mustChangePassword: true }) }))
    await renderApp()

    await fillAndSubmit('nora.bennett@toktickit.test', 'ChangeMe123!')

    await waitFor(() => expect(window.location.pathname).toBe('/change-password'))
  })

  it('requires both fields before it calls the API', async () => {
    const calls = mockApi(() => Response.json({ user: authUser() }))
    await renderApp()

    await userEvent.setup().click(screen.getByRole('button', { name: /Sign in/i }))

    expect(await screen.findByText('Enter your email address')).toBeInTheDocument()
    expect(screen.getByText('Enter your password')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })
})

describe('the remembered destination (review of PR #52)', () => {
  it('resumes a path the new user can open', async () => {
    // Driven through the real redirect rather than by seeding router state:
    // RequireAuth is what records where the visitor was going, so this proves
    // the two halves agree.
    mockApi(() => Response.json({ user: authUser({ role: 'REQUESTER' }) }))
    window.history.pushState({}, '', '/tickets/42')
    await renderApp()
    await waitFor(() => expect(window.location.pathname).toBe('/login'))

    await fillAndSubmit('peter.parker@toktickit.test', 'ChangeMe123!')

    await waitFor(() => expect(window.location.pathname).toBe('/tickets/42'))
  })

  it('ignores one the new user cannot, and sends them home instead', async () => {
    // The remembered path belongs to whoever used this browser last. A
    // Requester's session expiring on their own Ticket, then a colleague
    // signing in on the same machine, must not drop the colleague onto a
    // stranger's Ticket — the API refuses them, but a 404 is a poor way to
    // find out.
    mockApi(() => Response.json({ user: authUser({ role: 'IT_STAFF' }) }))
    window.history.pushState({}, '', '/tickets/42')
    await renderApp()
    await waitFor(() => expect(window.location.pathname).toBe('/login'))

    await fillAndSubmit('sarah.chen@toktickit.test', 'ChangeMe123!')

    await waitFor(() => expect(window.location.pathname).toBe('/staff/tickets'))
  })
})

describe('UI-02 Login failure (AC-06, BR-08)', () => {
  it('shows one generic message and keeps the email', async () => {
    mockApi(() => Response.json({ error: 'Invalid email or password' }, { status: 401 }))
    await renderApp()

    await fillAndSubmit('peter.parker@toktickit.test', 'wrong')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Invalid email or password.')

    // The message names both fields precisely so that it favours neither.
    // What it must never do is say which one was wrong, or that the account
    // exists, or that it is deactivated — the server answers all three cases
    // identically and the screen must not undo that.
    expect(alert).not.toHaveTextContent(/inactive|deactivated|disabled|no account|not found|unknown/i)
    expect(alert).toHaveTextContent('Invalid email or password.')

    // The email survives; the password does not. Retyping an address you got
    // right is busywork.
    expect(screen.getByLabelText(/Email address/i)).toHaveValue(
      'peter.parker@toktickit.test',
    )
    expect(screen.getByLabelText(/^Password/i)).toHaveValue('')
    expect(window.location.pathname).toBe('/login')
  })
})

describe('UI-03 Login busy state (AC-07)', () => {
  it('disables the control while the request is in flight and sends once', async () => {
    let release: (value: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    const calls = mockApi(() => pending as unknown as Response)

    await renderApp()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Email address/i), 'peter.parker@toktickit.test')
    await user.type(screen.getByLabelText(/^Password/i), 'ChangeMe123!')
    await user.click(screen.getByRole('button', { name: /Sign in/i }))

    const submit = await screen.findByRole('button', { name: /Signing in/i })
    expect(submit).toBeDisabled()

    // A second click while busy must not produce a second request.
    await user.click(submit).catch(() => {})
    expect(calls).toHaveLength(1)

    release(Response.json({ user: authUser() }))
    await waitFor(() => expect(window.location.pathname).toBe('/tickets'))
  })
})

describe('UI-04 Login when the API is unreachable (AC-44)', () => {
  it('shows a safe failure with no internal detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
      const auth = authRoutes(null)(String(input))
      return auth ?? Promise.reject(new Error('Failed to fetch'))
    }) as typeof fetch)
    await renderApp()

    await fillAndSubmit('peter.parker@toktickit.test', 'ChangeMe123!')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Unable to sign in right now/i)
    expect(alert).not.toHaveTextContent(/Failed to fetch/)
    expect(window.location.pathname).toBe('/login')
  })
})
