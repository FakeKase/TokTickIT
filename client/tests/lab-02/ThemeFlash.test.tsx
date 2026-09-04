import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY, initialTheme } from '../../src/theme/themeContext'
// Vite's ?raw import hands us the shipped markup as a string, so the test needs
// no Node filesystem APIs (the app tsconfig deliberately excludes node types).
import indexHtml from '../../index.html?raw'
import themeCss from '../../src/theme.css?raw'

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

/** The page background each theme declares in the inlined critical CSS. */
function criticalBackgrounds() {
  const style = indexHtml.match(/<style>([\s\S]*?)<\/style>/)
  if (!style) throw new Error('index.html no longer inlines critical CSS — the first paint is unstyled')

  const light = style[1].match(/:root\s*\{[^}]*background:\s*(#[0-9a-f]{3,8})/i)
  const dark = style[1].match(/:root\[data-theme='dark'\]\s*\{[^}]*background:\s*(#[0-9a-f]{3,8})/i)
  if (!light || !dark) throw new Error('critical CSS no longer declares a background for both themes')

  return { light: light[1].toLowerCase(), dark: dark[1].toLowerCase() }
}

/** The --zg-bg token each theme declares in the real stylesheet. */
function tokenBackgrounds() {
  const lightBlock = themeCss.match(/:root\s*\{([\s\S]*?)\}/)
  const darkBlock = themeCss.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\}/)
  if (!lightBlock || !darkBlock) throw new Error('theme.css no longer declares both :root blocks')

  const read = (block: string) => {
    const found = block.match(/--zg-bg:\s*(#[0-9a-f]{3,8})/i)
    if (!found) throw new Error('theme.css block no longer declares --zg-bg')
    return found[1].toLowerCase()
  }

  return { light: read(lightBlock[1]), dark: read(darkBlock[1]) }
}

// The document has to paint the right colour before any stylesheet is attached:
// every .css file is imported from main.tsx, so in dev Vite injects them from
// JavaScript and first paint happens with no CSS at all. index.html therefore
// inlines the page background for both themes — which duplicates --zg-bg, so
// these two assertions keep the copy honest.
describe('Critical background CSS', () => {
  it('is inlined for both themes', () => {
    const { light, dark } = criticalBackgrounds()

    expect(light).toBeTruthy()
    expect(dark).toBeTruthy()
    expect(light).not.toBe(dark)
  })

  it('matches --zg-bg in theme.css', () => {
    expect(criticalBackgrounds()).toEqual(tokenBackgrounds())
  })

  it('is declared before the module script, so it applies to the first paint', () => {
    expect(indexHtml.indexOf('<style>')).toBeLessThan(indexHtml.indexOf('type="module"'))
  })
})

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
