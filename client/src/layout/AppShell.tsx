import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useSelectedRequester } from '../requester/useSelectedRequester'
import { ThemeToggle } from '../theme/ThemeToggle'
import './AppShell.css'

const NAV_ITEMS = [
  { to: '/tickets', label: 'My Tickets' },
  { to: '/tickets/new', label: 'Create Ticket' },
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
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `ttk-shell__nav-link${isActive ? ' ttk-shell__nav-link--active' : ''}`
                }
                onClick={closeNav}
              >
                {item.label}
              </NavLink>
            ))}
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
