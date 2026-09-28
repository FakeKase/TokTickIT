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

/**
 * The URL space each role may open, used to decide whether a remembered
 * destination still makes sense for whoever actually signed in.
 *
 * Every role may open "/" — the Check System screen belongs to nobody in
 * particular.
 */
const REACHABLE: Record<Role, string[]> = {
  REQUESTER: ['/tickets'],
  IT_STAFF: ['/staff'],
  ADMINISTRATOR: ['/staff', '/admin'],
}

/**
 * Whether `path` is somewhere this role can go.
 *
 * Used for the "you were heading here before we asked you to sign in" redirect.
 * That path was recorded for whoever was using the browser last, which is not
 * necessarily the person who just signed in: if a Requester's session expires
 * on their own Ticket and a colleague signs in on the same machine, following
 * it blindly drops the colleague onto a stranger's Ticket. The API refuses
 * them, so nothing leaks — but landing on a 404 is a poor way to learn that.
 */
export function canRoleOpen(role: Role, path: string): boolean {
  const route = path.split('?')[0]
  if (route === '/') return true
  return REACHABLE[role].some(
    (prefix) => route === prefix || route.startsWith(`${prefix}/`),
  )
}
