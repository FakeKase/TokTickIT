import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// What the Lab 4 visual checks measure with. Each of these answers a question
// a screenshot cannot: a capture of a broken layout is still a capture.

export const THEMES = ['light', 'dark'] as const

export async function setTheme(page: Page, theme: string) {
  await page.addInitScript((value) => localStorage.setItem('toktickit.theme', value), theme)
}

/** Nothing on the page is wider than its own box: no clipped label, badge or
 *  button. Elements built to truncate with an ellipsis are exempt, since that
 *  is them working. */
export async function expectNothingClipped(page: Page) {
  const clipped = await page.evaluate(() => {
    const found: string[] = []
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>('.ttk-btn, .ttk-badge, label, h1, h2, h3, th, legend, dt'),
    )) {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || el.offsetParent === null) continue
      if (style.textOverflow === 'ellipsis') continue
      if (el.scrollWidth > el.clientWidth + 1 && style.overflow !== 'visible') {
        found.push(`${el.tagName.toLowerCase()}.${el.className}: "${el.textContent?.trim().slice(0, 30)}"`)
      }
    }
    return found
  })
  expect(clipped, 'elements whose text is cut off').toEqual([])
}

/**
 * Every visible descendant lies inside its container, side to side.
 *
 * The page-wide check only sees what passes the edge of the viewport. A field
 * a few pixels wider than the card it sits in stays inside the viewport,
 * because of the page's own padding, and still looks broken.
 */
export async function expectContained(container: Locator, what: string) {
  await expect(container, what).toBeVisible()
  const outside = await container.evaluate((box) => {
    const bounds = box.getBoundingClientRect()
    const found: string[] = []
    for (const el of Array.from(box.querySelectorAll<HTMLElement>('*'))) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || getComputedStyle(el).visibility === 'hidden') continue
      if (rect.left < bounds.left - 0.5 || rect.right > bounds.right + 0.5) {
        found.push(
          `${el.tagName.toLowerCase()}#${el.id || el.className}: ${Math.round(rect.right - bounds.right)}px past the right edge`,
        )
      }
    }
    return found.slice(0, 5)
  })
  expect(outside, `${what}: content wider than its container`).toEqual([])
}

/** What decides how a surface looks: fill, border and corner. */
export const surfaceOf = (locator: Locator) =>
  locator.first().evaluate((el) => {
    const style = getComputedStyle(el)
    // A border that is not drawn has no colour worth comparing.
    const border =
      parseFloat(style.borderTopWidth) > 0
        ? `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`
        : 'no border'
    return [style.backgroundColor, border, style.borderTopLeftRadius].join(' | ')
  })

/** What decides how text looks: family, size, weight and colour. */
export const typeOf = (locator: Locator) =>
  locator.first().evaluate((el) => {
    const style = getComputedStyle(el)
    return [style.fontFamily, style.fontSize, style.fontWeight, style.color].join(' | ')
  })

/** A badge's label, the look that sets its family apart, and how readable the
 *  label is on its own fill (WCAG contrast ratio). */
export const badgeLook = (locator: Locator) =>
  locator.first().evaluate((el) => {
    const luminance = (rgb: string) => {
      const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
        const channel = Number(value) / 255
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const style = getComputedStyle(el)
    const [bg, fg] = [luminance(style.backgroundColor), luminance(style.color)]
    return {
      text: el.textContent?.trim() ?? '',
      signature: `${style.backgroundColor}|${style.color}`,
      contrast: (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05),
    }
  })

/**
 * Presses Tab a number of times and reports any control that takes focus
 * without showing it. Returns the controls that were reached, so a caller can
 * say that enough of the screen was walked for the check to mean something.
 */
export async function tabThrough(page: Page, presses: number, within?: Locator) {
  const unseen: string[] = []
  const visited = new Set<string>()
  for (let press = 0; press < presses; press += 1) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const style = getComputedStyle(el)
      const ring = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
      const shadow = style.boxShadow !== 'none'
      return {
        name: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 80)}"`,
        shown: ring || shadow,
      }
    })
    if (!info) continue
    visited.add(info.name)
    if (!info.shown) unseen.push(info.name)
    if (within) expect(await within.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  }
  expect(unseen, 'controls that take focus without showing it').toEqual([])
  return visited
}

/** The message a field points at is inside the field, starts below the
 *  control and close to it. */
export async function expectMessageUnder(control: Locator, what: string) {
  const describedBy = await control.getAttribute('aria-describedby')
  expect(describedBy, `${what} has no described-by message`).toBeTruthy()
  const message = control.page().locator(`[id="${describedBy!.split(' ').pop()}"]`)
  await expect(message).toBeVisible()

  // Both boxes in one read. The dialog scrolls to the first invalid field
  // after the messages appear, and two separate reads can straddle that
  // scroll and measure the two at different positions.
  const gap = await control.evaluate((field, id) => {
    const message = document.getElementById(id)!
    return message.getBoundingClientRect().top - field.getBoundingClientRect().bottom
  }, describedBy!.split(' ').pop()!)
  expect(gap, `${what}: message is not below its field`).toBeGreaterThanOrEqual(-1)
  expect(gap, `${what}: message is far from its field`).toBeLessThan(40)
  await expect(control).toHaveAttribute('aria-invalid', 'true')
}
