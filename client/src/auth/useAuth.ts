import { useContext } from 'react'
import { AuthContext } from './authContext'
import type { AuthContextValue } from './authContext'

/**
 * Reads the authenticated session. Throws outside the provider rather than
 * returning null, so a missing provider is an obvious error instead of a screen
 * that quietly behaves as though nobody is signed in — which, for a screen
 * guarded by RequireAuth, would be the most confusing possible failure.
 */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)

  if (value === null) {
    throw new Error('useAuth must be used inside an <AuthProvider>')
  }

  return value
}
