import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY, initialTheme } from '../../src/theme/themeContext'
// Vite's ?raw import hands us the shipped markup as a string, so the test needs
// no Node filesystem APIs (the app tsconfig deliberately excludes node types).
import indexHtml from '../../index.html?raw'

// UI-19: no flash of the wrong theme on load.
//
// The theme has to be stamped before the first paint, which React cannot do —
// /src/main.tsx is a module script, so it runs after the browser has already
// painted. index.html therefore carries a parser-blocking inline script.
//
// These tests execute that script's real source, read out of index.html, so a
// change to the resolution rule in themeContext.ts that is not mirrored in the
// markup fails here instead of shipping as a visible flash.

function inlineThemeScript(): string {
  const match = indexHtml.match(/<script>([\s\S]*?)<\/script>/)

  if (!match) {
    throw new Error('index.html no longer contains an inline <script> — the pre-paint theme stamp is gone')
  }

  return match[1]
}

function runInlineScript() {
  // eslint-disable-next-line no-new-func -- executing the shipped source is the point
  new Function(inlineThemeScript())()
  return document.documentElement.dataset.theme
}

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches }) as MediaQueryList,
  })
}

describe('Pre-paint theme stamp', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  afterEach(() => {
    delete document.documentElement.dataset.theme
    // @ts-expect-error - restore jsdom's "no matchMedia" state
    delete window.matchMedia
  })

  it('is present in index.html', () => {
    expect(inlineThemeScript()).toMatch(/data-theme|dataset\.theme/)
  })

  it('applies a stored dark preference without waiting for React', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')

    expect(runInlineScript()).toBe('dark')
  })

  it('applies a stored light preference even when the OS prefers dark', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    stubMatchMedia(true)

    expect(runInlineScript()).toBe('light')
  })

  it('falls back to the OS preference when nothing is stored', () => {
    stubMatchMedia(true)
    expect(runInlineScript()).toBe('dark')

    delete document.documentElement.dataset.theme
    stubMatchMedia(false)
    expect(runInlineScript()).toBe('light')
  })

  it('falls back to light when the OS preference cannot be read', () => {
    // jsdom ships no matchMedia at all, which is this case exactly.
    expect(runInlineScript()).toBe('light')
  })

  it('ignores a corrupted stored value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse')
    stubMatchMedia(true)

    expect(runInlineScript()).toBe('dark')
  })

  it.each([
    ['dark', true],
    ['light', true],
    [null, true],
    [null, false],
    ['chartreuse', false],
  ])(
    'agrees with initialTheme() for stored=%s, OS-dark=%s',
    (stored, osDark) => {
      if (stored !== null) window.localStorage.setItem(THEME_STORAGE_KEY, stored)
      stubMatchMedia(osDark)

      // The markup and the module must resolve identically, or the page would
      // stamp one theme before paint and React would swap to another after it.
      expect(runInlineScript()).toBe(initialTheme())
    },
  )
})
