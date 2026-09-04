import { createContext } from 'react'

/**
 * Light/dark appearance for the Zen Green palette (ui-spec.md §1).
 *
 * The resolved theme is written to `<html data-theme="...">` and every colour
 * comes from a `--zg-*` token that has a value in both blocks of theme.css, so
 * no component needs to know which theme is active.
 */

export const THEME_STORAGE_KEY = 'toktickit.theme'

/**
 * Colour transition is armed only for the moment of an actual switch, by
 * adding this class to <html> for THEME_TRANSITION_MS. Leaving a global
 * transition permanently in place would also animate first paint and every
 * ordinary hover/focus change, so it is opt-in per switch instead.
 */
export const THEME_TRANSITION_CLASS = 'ttk-theme-switching'
export const THEME_TRANSITION_MS = 220

export type Theme = 'light' | 'dark'

export interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

/** The OS-level preference, used only when the user has never chosen one. */
export function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function readStoredTheme(): Theme | null {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    return raw === 'light' || raw === 'dark' ? raw : null
  } catch {
    return null
  }
}

export function writeStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). The theme
    // still applies for this tab; only the preference is forgotten.
  }
}

/**
 * Always stamps an explicit value rather than leaving the choice to a
 * `prefers-color-scheme` media query, so an explicit light choice still wins
 * on a machine whose OS is set to dark.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

export function initialTheme(): Theme {
  return readStoredTheme() ?? systemTheme()
}
