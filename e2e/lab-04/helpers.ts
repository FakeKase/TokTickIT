import { expect } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { API } from '../lab-03/helpers'

export {
  ACCOUNTS,
  API,
  DEV_PASSWORD,
  FIXTURE_MARKER,
  VIEWPORTS,
  attachFile,
  cookieFor,
  createTicket,
  createUser,
  expectNoHorizontalScroll,
  firstRequester,
  loginAs,
  recordAction,
  sessionAs,
  settlePassword,
  signInThroughForm,
  workflowChange,
} from '../lab-03/helpers'

export { requesterWithoutTickets, secondRequester } from '../lab-02/helpers'

export const shot = (screen: string, name: string) =>
  `artifacts/lab-04/screenshots/${screen}/${name}.png`

/** The Actions Taken area of whichever Ticket Detail screen is open. */
export const actionsArea = (page: Page) => page.locator('#actions-taken')

/**
 * Corrects one Action Taken through the API, as the edit form does: the whole
 * row is sent back with the changes laid over it, naming the version it was
 * read at (BR-17).
 */
export async function editAction(
  request: APIRequestContext,
  ticketId: number,
  actionId: number,
  cookie: string,
  changes: Record<string, unknown>,
) {
  const headers = { Cookie: cookie }
  const listed = await request.get(`${API}/api/tickets/${ticketId}/actions`, { headers })
  const current = ((await listed.json()) as Record<string, unknown>[]).find((row) => row.id === actionId)
  expect(current, `Action Taken ${actionId} is not on Ticket ${ticketId}`).toBeTruthy()

  const response = await request.patch(`${API}/api/tickets/${ticketId}/actions/${actionId}`, {
    headers,
    data: {
      expectedVersion: current!.version,
      actionAt: current!.actionAt,
      description: current!.description,
      result: current!.result,
      followUpRequired: current!.followUpRequired,
      followUpNote: current!.followUpNote,
      attachmentNotes: current!.attachmentNotes,
      ...changes,
    },
  })
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json()) as { id: number; version: number }
}
