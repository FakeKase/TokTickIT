import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import App from '../../src/App'
import { REQUESTER_STORAGE_KEY } from '../../src/requester/requesterContext'
import shellCss from '../../src/layout/AppShell.css?raw'
import themeCss from '../../src/theme.css?raw'

// UI-18 (ui-spec.md §5, handout §8 "clear active-page indication"): exactly one
// primary nav item is marked active on any Requester-scoped screen.
//
// Regression: React Router's NavLink treats a link as active for descendant
// paths too, so "My Tickets" (/tickets) stayed underlined on /tickets/new with
// "Create Ticket" underlined at the same time.

const REQUESTER = {
  id: 1,
  name: 'Peter Parker',
  email: 'peter.parker@toktickit.test',
}

const ACTIVE_CLASS = 'ttk-shell__nav-link--active'

function renderAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

// Scoped to the Primary nav landmark: pages may legitimately link to the same
// destinations in their own body (Create Ticket has a "Back to My Tickets"
// link), and those are not what the active-state rule is about.
function primaryNav() {
  return within(screen.getByRole('navigation', { name: 'Primary' }))
}

function navLink(name: RegExp) {
  return primaryNav().getByRole('link', { name })
}

function activeLinkNames() {
  return primaryNav()
    .getAllByRole('link')
    .filter((link) => link.classList.contains(ACTIVE_CLASS))
    .map((link) => link.textContent)
}

describe('Primary nav active state', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, JSON.stringify(REQUESTER))
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(Response.json([])))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('marks only My Tickets active on /tickets', () => {
    renderAt('/tickets')

    expect(navLink(/My Tickets/i)).toHaveClass(ACTIVE_CLASS)
    expect(navLink(/Create Ticket/i)).not.toHaveClass(ACTIVE_CLASS)
    expect(activeLinkNames()).toEqual(['My Tickets'])
  })

  it('marks only Create Ticket active on /tickets/new', () => {
    renderAt('/tickets/new')

    expect(navLink(/Create Ticket/i)).toHaveClass(ACTIVE_CLASS)
    expect(navLink(/My Tickets/i)).not.toHaveClass(ACTIVE_CLASS)
    expect(activeLinkNames()).toEqual(['Create Ticket'])
  })

  it('keeps My Tickets active on a Ticket Detail route', () => {
    // Detail is a child of the list, so the list stays the current section —
    // otherwise no nav item is indicated at all on that screen.
    renderAt('/tickets/42')

    expect(navLink(/My Tickets/i)).toHaveClass(ACTIVE_CLASS)
    expect(navLink(/Create Ticket/i)).not.toHaveClass(ACTIVE_CLASS)
    expect(activeLinkNames()).toEqual(['My Tickets'])
  })

  it('marks the active item for assistive tech, not just visually', () => {
    renderAt('/tickets/new')

    expect(navLink(/Create Ticket/i)).toHaveAttribute('aria-current', 'page')
    expect(navLink(/My Tickets/i)).not.toHaveAttribute('aria-current')
  })

  it('marks nothing active outside the ticket section', () => {
    renderAt('/select-requester')

    expect(activeLinkNames()).toEqual([])
  })
})

// UI-20: the active item is marked by the green rule under it, not by an
// underlined word, and that rule stays visible in both themes.
//
// The header is --zg-primary in both themes, so --zg-nav-active is a single
// theme-independent value — asserted here, because reaching for --zg-secondary
// instead would be invisible in the light theme (#0b7a46 on #006b3c, 1.23:1).
describe('Active nav underline styling', () => {
  function activeRules() {
    return [...shellCss.matchAll(/\.ttk-shell__nav-link--active\s*\{([^}]*)\}/g)].map((m) => m[1])
  }

  it('never underlines the text', () => {
    for (const rule of activeRules()) {
      expect(rule).not.toMatch(/text-decoration:\s*underline/)
    }
    expect(shellCss).not.toMatch(/text-decoration:\s*underline/)
  })

  it('marks the active item with the green rule at every breakpoint', () => {
    const rules = activeRules()

    // Desktop and the mobile dropdown both need it: the mobile block re-declares
    // the link border after the desktop rule, so a missing override there would
    // leave the open menu with no indicator at all.
    expect(rules.length).toBeGreaterThanOrEqual(2)
    for (const rule of rules) {
      expect(rule).toMatch(/border-bottom-color:\s*var\(--zg-nav-active\)/)
    }
  })

  it('does not let the mobile shorthand reset the active border', () => {
    const mobileBlock = shellCss.slice(shellCss.indexOf('@media (max-width: 767px)'))

    expect(mobileBlock).not.toMatch(/\.ttk-shell__nav-link\s*\{[^}]*border-bottom:\s/)
  })

  it('uses a theme-independent colour, since the header is the same in both themes', () => {
    const light = themeCss.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    const dark = themeCss.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\}/)?.[1] ?? ''

    expect(light).toMatch(/--zg-nav-active:/)
    // Redefining it per theme would mean it had been tuned against something
    // other than the header, which does not change between themes.
    expect(dark).not.toMatch(/--zg-nav-active:/)
    expect(dark).toMatch(/--zg-primary:\s*#006b3c/i)
  })
})
