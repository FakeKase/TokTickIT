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
  recordAction,
  sessionAs,
  signInThroughForm,
  workflowChange,
} from '../lab-03/helpers'

export { requesterWithoutTickets, secondRequester } from '../lab-02/helpers'

export const shot = (screen: string, name: string) =>
  `artifacts/lab-04/screenshots/${screen}/${name}.png`

/** The Actions Taken area of whichever Ticket Detail screen is open. */
export const actionsArea = (page: Page) => page.locator('#actions-taken')
