import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  fetchCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  setUnauthorizedHandler,
} from '../api'
import type { AuthenticatedUser } from '../api'
import { AuthContext } from './authContext'
import type { AuthStatus } from './authContext'

/**
 * Holds the session for the whole app.
 *
 * On mount it asks the server who is signed in, because the cookie is httpOnly
 * and therefore invisible to this code: there is no way to answer the question
 * locally, and guessing from a cached value would keep showing a signed-in
 * shell after a session expired server-side.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('checking')

  const load = useCallback(async () => {
    try {
      setUser(await fetchCurrentUser())
      setStatus('authenticated')
    } catch {
      // A 401 is the ordinary answer for a visitor, not a failure worth
      // surfacing. A network error lands here too and is treated the same way:
      // either way the app has no session to work with, and Login is where an
      // unauthenticated person belongs.
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Any 401 from a protected endpoint means the session this client believed in
   * is gone - expired, or revoked by an Administrator deactivating the account.
   * Clearing it here is enough: the route guards do the rest, and the person
   * lands on Login instead of staring at a screen full of failure states.
   */
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null)
      setStatus('anonymous')
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const signedIn = await loginRequest(email, password)
    setUser(signedIn)
    setStatus('authenticated')
    return signedIn
  }, [])

  const signOut = useCallback(async () => {
    // Swallowed, not rethrown. Logout is idempotent server-side, the session
    // cookie is cleared either way, and the route guards put the person on
    // Login regardless — so there is nothing a caller could usefully do with
    // the error, and every call site was dropping it into an unhandled
    // rejection instead.
    await logoutRequest().catch(() => {})

    // Cleared even when the request failed. The alternative is a shell that
    // still shows a name and a nav the person can no longer use, which reads
    // as "logout is broken" rather than "the network is".
    setUser(null)
    setStatus('anonymous')
  }, [])

  const value = useMemo(
    () => ({ user, status, signIn, signOut, refresh: load }),
    [user, status, signIn, signOut, load],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
