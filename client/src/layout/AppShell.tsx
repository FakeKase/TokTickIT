import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useSelectedRequester } from '../requester/useSelectedRequester'
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
const NAV_ITEMS = [
  {
    to: '/tickets',
    label: 'My Tickets',
    // The list and every ticket detail, but not the create form.
    isActive: (pathname: string) =>
      pathname === '/tickets' ||
      (pathname.startsWith('/tickets/') && pathname !== '/tickets/new'),
  },
  {
    to: '/tickets/new',
    label: 'Create Ticket',
    isActive: (pathname: string) => pathname === '/tickets/new',
  },
]

/**
 * Application shell: header, primary nav, and the current-Requester area
 * (ui-spec.md §5). The Requester name comes from the selection context, and
 * "Change Requester" returns to the selector, which replaces the selection
 * outright per BR-05.
 */
export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  const { requester } = useSelectedRequester()
  const { pathname } = useLocation()

  function closeNav() {
    setNavOpen(false)
  }

  return (
    <div className="ttk-shell">
      <header className="ttk-shell__header">
        <div className="ttk-shell__header-inner">
          <Link to="/" className="ttk-shell__wordmark" onClick={closeNav}>
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
            {NAV_ITEMS.map((item) => {
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

          <div className="ttk-shell__requester">
            <ThemeToggle />
            <span className="ttk-shell__requester-name">
              {requester ? (
                <>
                  <span className="ttk-visually-hidden">Signed in for testing as </span>
                  {requester.name}
                </>
              ) : (
                'No Requester selected'
              )}
            </span>
            <Link
              to="/select-requester"
              className="ttk-btn ttk-btn--tertiary ttk-shell__change-requester"
              onClick={closeNav}
            >
              {requester ? 'Change Requester' : 'Select Requester'}
            </Link>
          </div>
        </div>
      </header>

      <main className="ttk-shell__main">
        <Outlet />
      </main>
    </div>
  )
}
