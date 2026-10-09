import type { Page } from '@playwright/test'

export {
  ACCOUNTS,
  API,
  DEV_PASSWORD,
  FIXTURE_MARKER,
  VIEWPORTS,
  cookieFor,
  createTicket,
  expectNoHorizontalScroll,
  firstRequester,
  loginAs,
  sessionAs,
} from '../lab-03/helpers'

export const shot = (screen: string, name: string) =>
  `artifacts/lab-04/screenshots/${screen}/${name}.png`

/** The Actions Taken area of whichever Ticket Detail screen is open. */
export const actionsArea = (page: Page) => page.locator('#actions-taken')
