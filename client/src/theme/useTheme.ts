import { useContext } from 'react'
import { ThemeContext } from './themeContext'
import type { ThemeContextValue } from './themeContext'

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)

  if (value === null) {
    throw new Error('useTheme must be used inside a <ThemeProvider>')
  }

  return value
}
