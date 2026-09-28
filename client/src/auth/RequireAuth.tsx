import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useAuth } from './useAuth'

/**
 * Route guard for every screen inside the application shell.
 *
 * Two redirects, in this order (BR-02, BR-14):
 *   no session            -> /login, remembering where they were going
 *   initial password held -> /change-password, and nowhere else
 *
 * A usability guard, not a security boundary: the API enforces both rules
 * itself, and this only decides what to render. Getting past it in a devtools
 * console buys a screen full of 401s.
 */
export function RequireAuth() {
  const { user, status } = useAuth()
  const location = useLocation()

  // Still asking the server. Rendering Login here would flash it at a
  // signed-in user on every page load.
  if (status === 'checking') {
    return <LoadingSpinner label="Checking your session" />
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }

  if (user.mustChangePassword) {
    return <Navigate to="/change-password" replace />
  }

  return <Outlet />
}
