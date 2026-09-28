import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'

// UI-05 to UI-07 (AC-02, AC-11, AC-12), ui-spec.md §1.2.

let signedIn: ReturnType<typeof authUser> | null = authUser({ mustChangePassword: true })

function mockApi(respond: () => Response) {
  const calls: unknown[] = []

  vi.spyOn(globalThis, 'fetch').mockImplementation(((
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input)

    if (url.includes('/api/auth/change-password')) {
      calls.push(JSON.parse(String(init?.body)))
      return Promise.resolve(respond())
    }

    const auth = authRoutes(signedIn)(url)
    return auth ?? Promise.resolve(Response.json([]))
  }) as typeof fetch)

  return calls
}

async function fill(current: string, next: string, confirm: string) {
  const user = userEvent.setup()
  await user.clear(screen.getByLabelText(/Current password/i))
  await user.type(screen.getByLabelText(/Current password/i), current)
  await user.type(screen.getByLabelText(/^New password/i), next)
  await user.type(screen.getByLabelText(/Confirm new password/i), confirm)
  await user.click(screen.getByRole('button', { name: /Save and continue/i }))
}

beforeEach(() => {
  vi.restoreAllMocks()
  signedIn = authUser({ mustChangePassword: true })
  window.history.pushState({}, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('UI-05 the gate (AC-02, BR-02)', () => {
  it('sends a gated user to Change Password from any route', async () => {
    mockApi(() => Response.json({ user: authUser() }))

    for (const path of ['/', '/tickets', '/tickets/new']) {
      window.history.pushState({}, '', path)
      await renderApp()

      // Waited for by content, not by pathname: after the first iteration the
      // path is already /change-password, so a pathname assertion passes
      // before this mount has even finished its session check.
      expect(
        await screen.findByText(/Your account was created with a temporary password/i),
      ).toBeInTheDocument()
      expect(window.location.pathname).toBe('/change-password')

      // Rendered once per path in the same test, so each mount is torn down
      // before the next one stacks another copy on top of it.
      cleanup()
    }
  })

  it('does not gate a user who has already changed it', async () => {
    signedIn = authUser({ mustChangePassword: false })
    mockApi(() => Response.json({ user: authUser() }))

    window.history.pushState({}, '', '/tickets')
    await renderApp()

    await waitFor(() => expect(window.location.pathname).toBe('/tickets'))
  })

  it('offers a way out, because a screen with no exit is a trap', async () => {
    mockApi(() => Response.json({ user: authUser() }))
    window.history.pushState({}, '', '/change-password')
    await renderApp()

    await userEvent.setup().click(screen.getByRole('button', { name: /Sign out instead/i }))

    await waitFor(() => expect(window.location.pathname).toBe('/login'))
  })
})

describe('UI-06 validation (AC-11, BR-13)', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/change-password')
  })

  it('rejects a short password without calling the API', async () => {
    const calls = mockApi(() => Response.json({ user: authUser() }))
    await renderApp()

    await fill('ChangeMe123!', 'Ab1!', 'Ab1!')

    // The exact error, not a loose match: the hint above the field says
    // "At least 8 characters…" too, and matching both would pass even if the
    // validation message never appeared.
    expect(await screen.findByText('Must be at least 8 characters')).toBeInTheDocument()
    expect(screen.getByLabelText(/^New password/i)).toHaveAttribute('aria-invalid', 'true')
    expect(calls).toHaveLength(0)
  })

  it('puts a confirmation mismatch on the confirmation field', async () => {
    const calls = mockApi(() => Response.json({ user: authUser() }))
    await renderApp()

    await fill('ChangeMe123!', 'Replacement1!', 'Replacement2!')

    const message = await screen.findByText(/does not match the new password/i)
    expect(message).toBeInTheDocument()
    expect(calls).toHaveLength(0)

    // On the confirmation, not on the new password: the user probably typed
    // that one correctly, and marking it sends them to fix the wrong field.
    const confirmField = screen.getByLabelText(/Confirm new password/i)
    expect(confirmField).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/^New password/i)).not.toHaveAttribute('aria-invalid')
  })

  it('rejects re-entering the current password', async () => {
    const calls = mockApi(() => Response.json({ user: authUser() }))
    await renderApp()

    await fill('ChangeMe123!', 'ChangeMe123!', 'ChangeMe123!')

    expect(
      await screen.findByText(/different from your current one/i),
    ).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('shows a wrong current password against the field the server blamed', async () => {
    mockApi(() =>
      Response.json(
        {
          error: 'Current password is incorrect',
          fields: { currentPassword: 'That is not your current password' },
        },
        { status: 401 },
      ),
    )
    await renderApp()

    await fill('NotMyPassword1!', 'Replacement1!', 'Replacement1!')

    expect(
      await screen.findByText('That is not your current password'),
    ).toBeInTheDocument()
    expect(window.location.pathname).toBe('/change-password')
  })
})

describe('an expired session during the change (review of PR #52)', () => {
  it('sends the user to Login instead of blaming their password', async () => {
    // The server answers a wrong current password with a 401 that carries
    // `fields`. A 401 *without* them means the session is gone — so the only
    // 401 reaching this path is the one the password had nothing to do with.
    mockApi(() => Response.json({ error: 'Authentication required' }, { status: 401 }))
    window.history.pushState({}, '', '/change-password')
    await renderApp()

    await fill('ChangeMe123!', 'Replacement1!', 'Replacement1!')

    await waitFor(() => expect(window.location.pathname).toBe('/login'))
    expect(
      screen.queryByText('That is not your current password'),
    ).not.toBeInTheDocument()
  })
})

describe('UI-07 success (AC-12)', () => {
  it('re-reads the session and continues into the application', async () => {
    const calls = mockApi(() => {
      // The server clears the flag, so the next /me answers differently — the
      // page re-reads it rather than assuming.
      signedIn = authUser({ mustChangePassword: false })
      return Response.json({ user: authUser({ mustChangePassword: false }) })
    })

    window.history.pushState({}, '', '/change-password')
    await renderApp()

    await fill('ChangeMe123!', 'Replacement1!', 'Replacement1!')

    await waitFor(() => expect(window.location.pathname).toBe('/tickets'))
    expect(calls).toEqual([
      {
        currentPassword: 'ChangeMe123!',
        newPassword: 'Replacement1!',
        confirmPassword: 'Replacement1!',
      },
    ])
  })
})
