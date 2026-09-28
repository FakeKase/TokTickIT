import type { AuthenticatedUser, Role } from '../../src/api'

/**
 * Signing in, for a test that renders <App />.
 *
 * Lab 2 seeded a Requester into localStorage; there is no localStorage to seed
 * any more. The identity now comes from `GET /api/auth/me`, so a test declares
 * who is signed in by answering that request - which is also what the real app
 * does, and why the route guards and the shell behave the same way here as in
 * a browser.
 */
export function authUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 1,
    name: 'Peter Parker',
    email: 'peter.parker@toktickit.test',
    role: 'REQUESTER' as Role,
    isActive: true,
    mustChangePassword: false,
    createdAt: '2026-09-01T09:00:00.000Z',
    ...overrides,
  }
}

/**
 * Answers the auth endpoints for a fetch mock: `me` returns the given user, or
 * 401 for `null`, and `logout` succeeds. Returns undefined for every other URL
 * so the caller's own handler takes it from there.
 */
export function authRoutes(user: AuthenticatedUser | null) {
  return (raw: string): Promise<Response> | undefined => {
    if (raw.includes('/api/auth/me')) {
      return Promise.resolve(
        user
          ? Response.json({ user })
          : Response.json({ error: 'Authentication required' }, { status: 401 }),
      )
    }
    if (raw.includes('/api/auth/logout')) {
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    return undefined
  }
}
