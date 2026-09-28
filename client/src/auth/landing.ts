import type { Role } from '../api'

/**
 * Where each role belongs after signing in, and where a Forbidden state sends
 * someone back to (ui-spec.md §2).
 *
 * One table, because "the Requester's home page" is answered in three places —
 * login, the password-change redirect, and the Forbidden action — and three
 * copies would eventually disagree.
 */
const LANDING: Record<Role, string> = {
  REQUESTER: '/tickets',
  IT_STAFF: '/staff/tickets',
  ADMINISTRATOR: '/admin/users',
}

export const landingPathFor = (role: Role): string => LANDING[role]
