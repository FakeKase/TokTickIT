import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import type { Role } from '../api'
import { landingPathFor } from '../auth/landing'
import { Badge } from '../components/Badge'
import { ThemeToggle } from '../theme/ThemeToggle'
import './AppShell.css'

/**
 * Each item owns a slice of the URL space, declared next to the item itself.
 *
 * `NavLink`'s built-in matching is not usable here: it treats a link as active
 * for descendant paths too, so `/tickets` stayed active on `/tickets/new` and
 * both items were underlined (and both carried `aria-current="page"`) at once.
 * Adding `end` would fix that but then leave no item indicated at all while
 * reading a ticket, which handout §8 asks for.
 */
interface NavItem {
  to: string
  label: string
  isActive: (pathname: string) => boolean
}

/**
 * Navigation per role (ui-spec.md §2). Items a role may not reach are not
 * rendered at all, rather than rendered and disabled: a disabled link to a
 * place you can never go is an invitation, and the server refuses the route
 * regardless of what this table says.
 */
const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  REQUESTER: [
    {
      // Active on its own route only. A Ticket opened from a dashboard row
      // lives under My Tickets, and that is the item it marks (ui-spec.md §1).
      to: '/dashboard',
      label: 'Dashboard',
      isActive: (pathname) => pathname === '/dashboard',
    },
    {
      to: '/tickets',
      label: 'My Tickets',
      // The list and every ticket detail, but not the create form.
      isActive: (pathname) =>
        pathname === '/tickets' ||
        (pathname.startsWith('/tickets/') && pathname !== '/tickets/new'),
    },
    {
      to: '/tickets/new',
      label: 'Create Ticket',
      isActive: (pathname) => pathname === '/tickets/new',
    },
  ],
  IT_STAFF: [
    {
      to: '/staff/dashboard',
      label: 'Dashboard',
      isActive: (pathname) => pathname === '/staff/dashboard',
    },
    {
      to: '/staff/tickets',
      label: 'Ticket Queue',
      isActive: (pathname) => pathname.startsWith('/staff/tickets'),
    },
  ],
  ADMINISTRATOR: [
    {
      to: '/staff/dashboard',
      label: 'Dashboard',
      isActive: (pathname) => pathname === '/staff/dashboard',
    },
    {
      to: '/staff/tickets',
      label: 'Ticket Queue',
      isActive: (pathname) => pathname.startsWith('/staff/tickets'),
    },
    {
      to: '/admin/users',
      label: 'User Management',
      isActive: (pathname) => pathname.startsWith('/admin/users'),
    },
    {
      to: '/system-status',
      label: 'System Status',
      isActive: (pathname) => pathname === '/system-status',
    },
  ],
}

const ROLE_LABEL: Record<Role, string> = {
  REQUESTER: 'Requester',
  IT_STAFF: 'IT Staff',
  ADMINISTRATOR: 'Administrator',
}

/**
 * Application shell: header, role-specific nav, and the signed-in user
 * (ui-spec.md §2). Lab 2's Requester selector and its "Change Requester"
 * action are gone; the identity here is the authenticated session, and the
 * only way to change it is to sign out.
 */
export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const navItems = user ? NAV_BY_ROLE[user.role] : []

  function closeNav() {
    setNavOpen(false)
  }

  async function handleSignOut() {
    closeNav()
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="ttk-shell">
      {/* More than two items do not fit beside the identity controls at
          tablet width, so a role that has more gets the menu there too
          (AppShell.css). */}
      <header
        className={`ttk-shell__header${navItems.length > 2 ? ' ttk-shell__header--long-nav' : ''}`}
      >
        <div className="ttk-shell__header-inner">
          <Link
            to={user ? landingPathFor(user.role) : '/'}
            className="ttk-shell__wordmark"
            onClick={closeNav}
          >
            TokTickIT
          </Link>

          <button
            type="button"
            className="ttk-shell__nav-toggle"
            aria-expanded={navOpen}
            aria-controls="ttk-primary-nav"
            aria-label={navOpen ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setNavOpen((open) => !open)}
          >
            <span className="ttk-shell__nav-toggle-bar" aria-hidden="true" />
            <span className="ttk-shell__nav-toggle-bar" aria-hidden="true" />
            <span className="ttk-shell__nav-toggle-bar" aria-hidden="true" />
          </button>

          <nav
            id="ttk-primary-nav"
            className={`ttk-shell__nav ${navOpen ? 'ttk-shell__nav--open' : ''}`}
            aria-label="Primary"
          >
            {navItems.map((item) => {
              const active = item.isActive(pathname)

              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`ttk-shell__nav-link${active ? ' ttk-shell__nav-link--active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={closeNav}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="ttk-shell__identity">
            <ThemeToggle />
            {user && (
              <span className="ttk-shell__user">
                <span className="ttk-shell__user-name">
                  <span className="ttk-visually-hidden">Signed in as </span>
                  {user.name}
                </span>
                <Badge className="ttk-shell__role">{ROLE_LABEL[user.role]}</Badge>
              </span>
            )}
            {/* The full label does not fit beside the wordmark, toggle and menu
                control at 375px, so mobile shows a shortened one. The
                accessible name stays the full phrase either way. */}
            <button
              type="button"
              className="ttk-btn ttk-btn--tertiary ttk-shell__signout"
              aria-label="Log out"
              onClick={() => {
                void handleSignOut()
              }}
            >
              <span className="ttk-shell__signout-long">Log out</span>
              <span className="ttk-shell__signout-short" aria-hidden="true">
                Out
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="ttk-shell__main">
        <Outlet />
      </main>
    </div>
  )
}
