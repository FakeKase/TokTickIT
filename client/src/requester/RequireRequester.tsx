import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSelectedRequester } from './useSelectedRequester'

/**
 * Route guard for every Requester-scoped screen (AC-02).
 *
 * With no Requester selected the user is sent to the Selection screen instead
 * of the requested page. `replace` keeps the blocked URL out of history so
 * Back does not bounce the user between the two, and the attempted path is
 * passed along so the selector can return there once a Requester is chosen.
 *
 * This is a usability guard over Lab 2 scaffolding, not a security boundary —
 * ownership is enforced server-side per BR-08.
 */
export function RequireRequester() {
  const { requester } = useSelectedRequester()
  const location = useLocation()

  if (!requester) {
    return (
      <Navigate
        to="/select-requester"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }

  return <Outlet />
}
