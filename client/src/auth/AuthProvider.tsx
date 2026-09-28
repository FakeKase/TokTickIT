import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchCurrentUser, login as loginRequest, logout as logoutRequest } from '../api'
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

  const signIn = useCallback(async (email: string, password: string) => {
    const signedIn = await loginRequest(email, password)
    setUser(signedIn)
    setStatus('authenticated')
    return signedIn
  }, [])

  const signOut = useCallback(async () => {
    try {
      await logoutRequest()
    } finally {
      // Cleared even if the request failed. The alternative is a shell that
      // still shows a name and a nav the person can no longer use, which reads
      // as "logout is broken" rather than "the network is".
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  const value = useMemo(
    () => ({ user, status, signIn, signOut, refresh: load }),
    [user, status, signIn, signOut, load],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
