import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../../src/App'
import { REQUESTER_STORAGE_KEY } from '../../src/requester/requesterContext'

// UI-18 (ui-spec.md §5, handout §8 "clear active-page indication"): exactly one
// primary nav item is marked active on any Requester-scoped screen.
//
// Regression: React Router's NavLink treats a link as active for descendant
// paths too, so "My Tickets" (/tickets) stayed underlined on /tickets/new with
// "Create Ticket" underlined at the same time.

const REQUESTER = {
  id: 1,
  name: 'Jennifer Anderson',
  email: 'jennifer.anderson@toktickit.test',
}

const ACTIVE_CLASS = 'ttk-shell__nav-link--active'

function renderAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

function navLink(name: RegExp) {
  return screen.getByRole('link', { name })
}

function activeLinkNames() {
  return screen
    .getAllByRole('link')
    .filter((link) => link.classList.contains(ACTIVE_CLASS))
    .map((link) => link.textContent)
}

describe('Primary nav active state', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, JSON.stringify(REQUESTER))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([]))
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
