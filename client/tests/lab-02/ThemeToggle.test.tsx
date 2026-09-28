import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../helpers/renderApp'
import { authRoutes, authUser } from '../helpers/auth'
import {
  THEME_STORAGE_KEY,
  THEME_TRANSITION_CLASS,
  THEME_TRANSITION_MS,
} from '../../src/theme/themeContext'

// UI-17 (ui-spec.md §1, §5): the light/dark switch in the app shell. The theme
// is stamped on <html data-theme>, so these assertions read the same attribute
// the stylesheet selects on rather than inspecting computed colours.

function themeAttr() {
  return document.documentElement.dataset.theme
}

/**
 * jsdom implements no `matchMedia` at all, so there is nothing for `vi.spyOn`
 * to replace — the property has to be defined outright. Its absence is itself
 * the "cannot be read" case the fallback below covers.
 */
function stubMatchMedia(impl: () => MediaQueryList) {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: impl })
}

const signedIn = authUser()

describe('Theme toggle', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
    document.documentElement.classList.remove(THEME_TRANSITION_CLASS)
    vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
      const auth = authRoutes(signedIn)(String(input))
      return auth ?? Promise.resolve(Response.json([]))
    }) as typeof fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete document.documentElement.dataset.theme
    // @ts-expect-error - removing the stub restores jsdom's "no matchMedia" state
    delete window.matchMedia
  })

  it('renders in the header and defaults to light with no stored preference', async () => {
    await renderApp()

    expect(screen.getByRole('button', { name: /Switch to dark theme/i })).toBeInTheDocument()
    expect(themeAttr()).toBe('light')
  })

  it('switches to dark and back, updating its own accessible name', async () => {
    const user = userEvent.setup()
    await renderApp()

    await user.click(screen.getByRole('button', { name: /Switch to dark theme/i }))
    expect(themeAttr()).toBe('dark')

    const backToLight = screen.getByRole('button', { name: /Switch to light theme/i })
    expect(backToLight).toHaveAttribute('aria-pressed', 'true')

    await user.click(backToLight)
    expect(themeAttr()).toBe('light')
    expect(screen.getByRole('button', { name: /Switch to dark theme/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('persists the choice across a reload', async () => {
    const user = userEvent.setup()
    const first = await renderApp()

    await user.click(screen.getByRole('button', { name: /Switch to dark theme/i }))
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    first.unmount()
    delete document.documentElement.dataset.theme
    await renderApp()

    expect(themeAttr()).toBe('dark')
    expect(screen.getByRole('button', { name: /Switch to light theme/i })).toBeInTheDocument()
  })

  it('follows the OS preference only until an explicit choice is stored', async () => {
    stubMatchMedia(() => ({ matches: true }) as MediaQueryList)

    const first = await renderApp()
    expect(themeAttr()).toBe('dark')

    // An explicit light choice must win over a dark OS setting.
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Switch to light theme/i }))
    expect(themeAttr()).toBe('light')

    first.unmount()
    delete document.documentElement.dataset.theme
    await renderApp()

    expect(themeAttr()).toBe('light')
  })

  // These two use fireEvent rather than userEvent: userEvent's own inter-event
  // delay deadlocks against fake timers, and what is under test here is the
  // transition window's timing, not the fidelity of the click itself.
  it('arms the colour transition for the switch only, then disarms it', async () => {
    // Rendered before the timers are faked: the session check resolves on a
    // real microtask, and waiting for it under fake timers would hang.
    await renderApp()
    vi.useFakeTimers()
    try {

      // Not armed on mount — otherwise first paint would animate too.
      expect(document.documentElement).not.toHaveClass(THEME_TRANSITION_CLASS)

      fireEvent.click(screen.getByRole('button', { name: /Switch to dark theme/i }))
      expect(document.documentElement).toHaveClass(THEME_TRANSITION_CLASS)
      expect(themeAttr()).toBe('dark')

      act(() => {
        vi.advanceTimersByTime(THEME_TRANSITION_MS + 10)
      })
      expect(document.documentElement).not.toHaveClass(THEME_TRANSITION_CLASS)
    } finally {
      vi.useRealTimers()
    }
  })

  it('restarts the transition window when switched again mid-animation', async () => {
    // Rendered before the timers are faked: the session check resolves on a
    // real microtask, and waiting for it under fake timers would hang.
    await renderApp()
    vi.useFakeTimers()
    try {

      fireEvent.click(screen.getByRole('button', { name: /Switch to dark theme/i }))
      act(() => {
        vi.advanceTimersByTime(THEME_TRANSITION_MS - 50)
      })

      // Second switch before the first window closes.
      fireEvent.click(screen.getByRole('button', { name: /Switch to light theme/i }))
      act(() => {
        vi.advanceTimersByTime(60)
      })

      // The first timer must not have stripped the class out from under the second.
      expect(document.documentElement).toHaveClass(THEME_TRANSITION_CLASS)

      act(() => {
        vi.advanceTimersByTime(THEME_TRANSITION_MS)
      })
      expect(document.documentElement).not.toHaveClass(THEME_TRANSITION_CLASS)
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to light when the OS preference cannot be read', async () => {
    stubMatchMedia(() => {
      throw new Error('matchMedia unavailable')
    })

    await renderApp()

    expect(themeAttr()).toBe('light')
  })
})
