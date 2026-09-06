import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  THEME_TRANSITION_CLASS,
  THEME_TRANSITION_MS,
  ThemeContext,
  applyTheme,
  initialTheme,
  writeStoredTheme,
} from './themeContext'
import type { Theme, ThemeContextValue } from './themeContext'

/** Holds the active light/dark theme for the whole app. See themeContext.ts. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme)
  const transitionTimer = useRef<number | undefined>(undefined)

  /*
   * Layout effect, not useEffect: this runs before the browser paints, so a
   * theme change never shows one frame of the previous palette. The very
   * first stamp is done earlier still, by the inline script in index.html —
   * React does not mount until after the first paint, so this alone would
   * leave a stored dark preference flashing light on load.
   */
  useLayoutEffect(() => {
    applyTheme(theme)
  }, [theme])

  /**
   * Arms the colour transition. Driven from the change handlers rather than
   * from the effect above so it fires only on a deliberate switch, never on
   * mount. A second switch mid-animation restarts the window instead of
   * letting the first timer cut the second one short.
   */
  const startTransition = useCallback(() => {
    const root = document.documentElement
    root.classList.add(THEME_TRANSITION_CLASS)

    window.clearTimeout(transitionTimer.current)
    transitionTimer.current = window.setTimeout(() => {
      root.classList.remove(THEME_TRANSITION_CLASS)
      transitionTimer.current = undefined
    }, THEME_TRANSITION_MS)
  }, [])

  useEffect(
    () => () => {
      window.clearTimeout(transitionTimer.current)
      document.documentElement.classList.remove(THEME_TRANSITION_CLASS)
    },
    [],
  )

  const setTheme = useCallback(
    (next: Theme) => {
      startTransition()
      setThemeState(next)
      writeStoredTheme(next)
    },
    [startTransition],
  )

  const toggleTheme = useCallback(() => {
    startTransition()
    setThemeState((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      writeStoredTheme(next)
      return next
    })
  }, [startTransition])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, toggleTheme, setTheme }),
    [theme, toggleTheme, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
