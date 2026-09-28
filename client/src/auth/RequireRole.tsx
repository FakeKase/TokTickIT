import { Navigate, Outlet } from 'react-router-dom'
import type { Role } from '../api'
import { ErrorState } from '../components/ErrorState'
import { landingPathFor } from './landing'
import { useAuth } from './useAuth'

/**
 * Role guard for a group of routes (specification.md §5.1).
 *
 * Renders a Forbidden state rather than redirecting. A silent bounce to the
 * user's own landing page looks like a broken link and teaches them nothing;
 * ui-spec.md §2 asks for the reason to be visible, with a way onward.
 *
 * Nested inside RequireAuth, so `user` is always present here.
 */
export function RequireRole({ allow }: { allow: Role[] }) {
  const { user } = useAuth()

  if (!user) return <Navigate to="/login" replace />

  if (!allow.includes(user.role)) {
    return (
      <ErrorState
        title="You do not have permission to view this page"
        message="Your account does not have access to this part of TokTickIT."
        actionLabel="Go to your home page"
        actionTo={landingPathFor(user.role)}
      />
    )
  }

  return <Outlet />
}
