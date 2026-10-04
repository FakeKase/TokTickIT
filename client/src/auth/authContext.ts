import { createContext } from 'react'
import type { AuthenticatedUser } from '../api'

/**
 * The authenticated session, replacing Lab 2's selected-Requester context.
 *
 * The difference is not cosmetic. The old context held an identity the browser
 * chose and could change at will; this one holds an identity the server issued
 * and only the server can revoke. Nothing here is trusted by the API — every
 * request carries the httpOnly cookie, which this code cannot read — so the
 * value below exists to decide what to *render*, never to prove who someone is.
 */

/** `status` distinguishes "we have not asked yet" from "we asked and nobody is
 *  signed in". Rendering Login during the first check would flash the login
 *  screen at a signed-in user on every reload. */
export type AuthStatus = 'checking' | 'authenticated' | 'anonymous'

export interface AuthContextValue {
  user: AuthenticatedUser | null
  status: AuthStatus
  signIn: (email: string, password: string) => Promise<AuthenticatedUser>
  signOut: () => Promise<void>
  /** Re-reads the session after something changes it server-side, such as a
   *  password change clearing `mustChangePassword`. */
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
