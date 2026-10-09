import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ActionTaken, StaffTicketDetail, StatusTransition } from '../../src/api'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'

// UI-11 to UI-15 (Lab 4 AC-24, AC-27, AC-28, AC-29; BR-15, BR-16).
//
// The screen shows what the server says. It keeps no copy of the matrix or of
// the resolution gate, so these tests give it a Ticket the way the server
// would and check what it makes of that. That the gate holds when the screen
// is bypassed is proved in server/tests/lab-04/ticket-workflow.api.test.ts.

const SARAH = { id: 9, name: 'Sarah Chen', role: 'IT_STAFF' as const }
const PETER = { id: 1, name: 'Peter Parker', role: 'REQUESTER' as const }
let signedIn = authUser(SARAH)

const NO_ACTION = 'Record an Action Taken before resolving this Ticket'
const FOLLOW_UP = 'The latest Action Taken still requires follow-up'
const NO_OWNER = 'A Ticket needs a Ticket Owner before it can be Resolved'
const STALE = 'This Ticket was changed by someone else. Reload it and try again.'

const moves = (resolved: string | null): StatusTransition[] => [
  { to: 'WAITING_FOR_REQUESTER', requiresOwner: false, blockedReason: null },
  { to: 'RESOLVED', requiresOwner: true, blockedReason: resolved },
  { to: 'CANCELLED', requiresOwner: false, blockedReason: null },
]

const BASE: StaffTicketDetail = {
  id: 42,
  ticketNumber: 'TKT-2026-000042',
  summary: 'Projector will not power on',
  description: 'The lecture theatre projector shows no light.',
  category: { id: 10, name: 'Hardware' },
  relatedSystem: { id: 20, name: 'Corporate Laptop' },
  requester: { id: 1, name: 'Peter Parker' },
  owner: { id: 9, name: 'Sarah Chen' },
  requestedPriority: 'LOW',
  itPriority: 'MEDIUM',
  currentStatus: 'IN_PROGRESS',
  requesterResolvedAt: null,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-02T09:00:00.000Z',
  attachments: [],
  transitions: moves(null),
  ownerRequired: false,
  version: 4,
  resolvedAt: null,
}

interface Sent {
  method: string
  path: string
  body: Record<string, unknown>
}

let sent: Sent[] = []
let ticketReads = 0
/** The Ticket and its Actions Taken as the mock server holds them. */
let server: StaffTicketDetail
let actions: ActionTaken[] = []

type Answer = Response | Promise<Response> | undefined

function mockApi(patch?: (what: string, body: Record<string, unknown>) => Answer) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const auth = authRoutes(signedIn)(url)
    if (auth) return auth

    const method = init?.method ?? 'GET'
    const path = new URL(url, 'http://localhost').pathname
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (method !== 'GET') sent.push({ method, path, body })
    const answer = (value: Response | Promise<Response>) => Promise.resolve(value)

    const patched = /\/api\/staff\/tickets\/42\/(owner|it-priority|status)$/.exec(path)
    if (patched && method === 'PATCH') {
      const custom = patch?.(patched[1], body)
      if (custom) return answer(custom)
      // The default server: applies the change, raises the version, and
      // returns the whole Ticket with the moves of its new status.
      server = { ...server, version: server.version + 1 }
      if (patched[1] === 'it-priority') {
        server = { ...server, itPriority: body.itPriority as StaffTicketDetail['itPriority'] }
      }
      if (patched[1] === 'owner') {
        server = { ...server, owner: body.ownerId === null ? null : { id: 9, name: 'Sarah Chen' } }
      }
      if (patched[1] === 'status') {
        server = {
          ...server,
          currentStatus: body.currentStatus as StaffTicketDetail['currentStatus'],
          resolvedAt: body.currentStatus === 'RESOLVED' ? '2026-10-06T04:00:00.000Z' : null,
          transitions: [
            { to: 'CLOSED', requiresOwner: true, blockedReason: null },
            { to: 'REOPENED', requiresOwner: false, blockedReason: null },
          ],
          ownerRequired: true,
        }
      }
      return answer(Response.json(server))
    }

    if (path === '/api/tickets/42/actions') {
      if (method === 'POST') {
        const created: ActionTaken = {
          id: 77,
          ticketId: 42,
          actionAt: String(body.actionAt),
          description: String(body.description),
          result: String(body.result),
          followUpRequired: Boolean(body.followUpRequired),
          followUpNote: (body.followUpNote as string | null) ?? null,
          attachmentNotes: null,
          performedBy: { id: 9, name: 'Sarah Chen' },
          createdAt: '2026-10-06T04:00:00.000Z',
          editedBy: null,
          editedAt: null,
          version: 1,
        }
        actions = [created, ...actions]
        // As the server's gate would now judge it.
        server = { ...server, transitions: moves(created.followUpRequired ? FOLLOW_UP : null) }
        return answer(Response.json(created, { status: 201 }))
      }
      return answer(Response.json(actions))
    }
    if (path.endsWith('/comments') || path.endsWith('/assignable-users')) return answer(Response.json([]))
    if (path === '/api/staff/tickets/42' || path === '/api/tickets/42') {
      ticketReads += 1
      return answer(Response.json(server))
    }
    return answer(Response.json([]))
  }) as typeof fetch)
}

const openAsStaff = async () => {
  window.history.pushState({}, '', '/staff/tickets/42')
  await renderApp()
  await screen.findByRole('heading', { name: 'TKT-2026-000042' })
}

const workflow = () => within(screen.getByRole('region', { name: 'Workflow' }))
const moveTo = () => workflow().getByLabelText('Move to') as HTMLSelectElement
const option = (name: RegExp) => within(moveTo()).getByRole('option', { name }) as HTMLOptionElement
/** The Ticket's own card, where its status is shown as a fact. */
const summary = () =>
  within(screen.getByRole('heading', { name: 'TKT-2026-000042' }).closest('.ttk-detail__card') as HTMLElement)

beforeEach(() => {
  vi.restoreAllMocks()
  signedIn = authUser(SARAH)
  sent = []
  ticketReads = 0
  server = BASE
  actions = []
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('UI-11 permitted and blocked moves (FR-08, AC-27)', () => {
  it('offers exactly the moves the server sent, in its order', async () => {
    mockApi()
    await openAsStaff()

    expect(within(moveTo()).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Choose a status…',
      'Waiting for Requester',
      'Resolved',
      'Cancelled',
    ])
    // Nothing is blocked, so nothing is said about blocking.
    expect(workflow().queryByTestId('blocked-RESOLVED')).not.toBeInTheDocument()
    expect(option(/^Resolved/)).not.toBeDisabled()
  })

  it.each([
    ['no Action Taken yet', NO_ACTION],
    ['follow-up still required', FOLLOW_UP],
  ])('disables Resolved and shows the server\'s reason as text: %s', async (_what, reason) => {
    server = { ...BASE, transitions: moves(reason) }
    mockApi()
    await openAsStaff()

    const resolved = option(/^Resolved/)
    expect(resolved).toBeDisabled()
    expect(resolved).toHaveTextContent('Resolved (not available yet)')

    // The reason is on the page as words, with the status named, and leads
    // to where it can be fixed.
    const line = workflow().getByTestId('blocked-RESOLVED')
    expect(line).toHaveTextContent(`Resolved: ${reason}.`)
    expect(within(line).getByRole('link', { name: 'Go to Actions Taken' })).toHaveAttribute('href', '#actions-taken')

    // The other moves are untouched.
    expect(option(/^Waiting for Requester/)).not.toBeDisabled()
    expect(option(/^Cancelled/)).not.toBeDisabled()
    expect(workflow().queryByTestId('blocked-CANCELLED')).not.toBeInTheDocument()
  })

  it('cannot be made to send a blocked move', async () => {
    server = { ...BASE, transitions: moves(NO_ACTION) }
    mockApi()
    await openAsStaff()

    await userEvent.selectOptions(moveTo(), 'RESOLVED').catch(() => {})

    expect(moveTo().value).toBe('')
    expect(workflow().getByRole('button', { name: 'Change status' })).toBeDisabled()
    expect(sent).toEqual([])
  })

  it('says a Ticket Owner is needed when that is what is missing, and does not point at Actions Taken', async () => {
    server = { ...BASE, owner: null, transitions: moves(NO_OWNER) }
    mockApi()
    await openAsStaff()

    expect(option(/^Resolved/)).toBeDisabled()
    expect(option(/^Resolved/)).toHaveTextContent('Resolved (needs a Ticket Owner)')
    expect(workflow().getByText(/needs a Ticket Owner before it can be Resolved or Closed/)).toBeInTheDocument()
    expect(workflow().queryByTestId('blocked-RESOLVED')).not.toBeInTheDocument()
  })

  it('shows no control at all for a status that leads nowhere', async () => {
    server = { ...BASE, currentStatus: 'CANCELLED', transitions: [] }
    mockApi()
    await openAsStaff()

    expect(workflow().queryByLabelText('Move to')).not.toBeInTheDocument()
    expect(workflow().getByText(/Cancelled is final/)).toBeInTheDocument()
  })
})

describe('UI-12 the gate clears without a page reload (AC-27)', () => {
  it('makes Resolved selectable as soon as an Action Taken is saved', async () => {
    server = { ...BASE, transitions: moves(NO_ACTION) }
    mockApi()
    await openAsStaff()
    expect(option(/^Resolved/)).toBeDisabled()
    const readsBefore = ticketReads

    const area = within(screen.getByRole('heading', { name: 'Actions Taken' }).closest('.ttk-actions') as HTMLElement)
    await userEvent.click(await area.findByRole('button', { name: 'Add Action Taken' }))
    const dialog = within(screen.getByRole('dialog'))
    await userEvent.type(dialog.getByLabelText(/^Action Description/), 'Replaced the lamp.')
    await userEvent.type(dialog.getByLabelText(/^Result/), 'Projector powers on.')
    await userEvent.click(dialog.getByRole('button', { name: 'Save Action Taken' }))

    // The Ticket was fetched again, and what it now says is on the screen.
    await waitFor(() => expect(option(/^Resolved/)).not.toBeDisabled())
    expect(ticketReads).toBe(readsBefore + 1)
    expect(option(/^Resolved/)).toHaveTextContent(/^Resolved$/)
    expect(workflow().queryByTestId('blocked-RESOLVED')).not.toBeInTheDocument()
  })

  it('changes the reason, and stays blocked, when the action saved asks for follow-up', async () => {
    server = { ...BASE, transitions: moves(NO_ACTION) }
    mockApi()
    await openAsStaff()

    const area = within(screen.getByRole('heading', { name: 'Actions Taken' }).closest('.ttk-actions') as HTMLElement)
    await userEvent.click(await area.findByRole('button', { name: 'Add Action Taken' }))
    const dialog = within(screen.getByRole('dialog'))
    await userEvent.type(dialog.getByLabelText(/^Action Description/), 'Replaced the lamp.')
    await userEvent.type(dialog.getByLabelText(/^Result/), 'Works for now.')
    await userEvent.click(dialog.getByLabelText('Follow-Up Required?'))
    await userEvent.type(dialog.getByLabelText(/^Follow-up Note/), 'Check lamp hours next week.')
    await userEvent.click(dialog.getByRole('button', { name: 'Save Action Taken' }))

    await waitFor(() => expect(workflow().getByTestId('blocked-RESOLVED')).toHaveTextContent(FOLLOW_UP))
    expect(option(/^Resolved/)).toBeDisabled()
  })
})

describe('UI-13 a successful change (BR-16, AC-28)', () => {
  it('sends the version with a status change, then shows the new status in the summary and announces it', async () => {
    mockApi()
    await openAsStaff()
    expect(summary().getByText('In Progress')).toBeInTheDocument()

    await userEvent.selectOptions(moveTo(), 'RESOLVED')
    await userEvent.click(workflow().getByRole('button', { name: 'Change status' }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      method: 'PATCH',
      path: '/api/staff/tickets/42/status',
      body: { currentStatus: 'RESOLVED', expectedVersion: 4 },
    })

    // The Ticket's own card, not only the panel that made the change.
    expect(await summary().findByText('Resolved')).toBeInTheDocument()
    expect(summary().queryByText('In Progress')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Status changed to Resolved.')
    // And the panel offers the moves of the new status.
    expect(within(moveTo()).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Choose a status…',
      'Closed',
      'Reopened',
    ])
  })

  it('sends the version with a priority change and with an ownership change', async () => {
    mockApi()
    await openAsStaff()

    await userEvent.selectOptions(workflow().getByLabelText('IT Priority'), 'URGENT')
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toEqual({ itPriority: 'URGENT', expectedVersion: 4 })

    // The next change is based on the Ticket the first one returned.
    await waitFor(() => expect(workflow().getByRole('button', { name: 'Unassign' })).toBeEnabled())
    await userEvent.click(workflow().getByRole('button', { name: 'Unassign' }))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1].body).toEqual({ ownerId: null, expectedVersion: 5 })
  })
})

describe('UI-14 a refused change (AC-29)', () => {
  it('shows the stale message beside the control and brings the Ticket up to date', async () => {
    // A colleague has since cancelled it; the first answer says so.
    const theirs: StaffTicketDetail = { ...BASE, currentStatus: 'CANCELLED', transitions: [], version: 5 }
    mockApi(() => {
      server = theirs
      return Response.json({ error: STALE, code: 'STALE_TICKET' }, { status: 409 })
    })
    await openAsStaff()
    const readsBefore = ticketReads

    await userEvent.selectOptions(moveTo(), 'WAITING_FOR_REQUESTER')
    await userEvent.click(workflow().getByRole('button', { name: 'Change status' }))

    const message = await workflow().findByText(STALE)
    expect(message).toHaveAttribute('role', 'alert')
    // Reloaded, and now showing what is true: Cancelled, with nowhere to go.
    await waitFor(() => expect(ticketReads).toBe(readsBefore + 1))
    expect(await summary().findByText('Cancelled')).toBeInTheDocument()
    expect(workflow().queryByLabelText('Move to')).not.toBeInTheDocument()
    // The message is still there to explain why the screen changed.
    expect(workflow().getByText(STALE)).toBeInTheDocument()
  })

  it('puts a stale priority change back to the value the Ticket really has', async () => {
    mockApi(() => {
      server = { ...BASE, itPriority: 'HIGH', version: 5 }
      return Response.json({ error: STALE, code: 'STALE_TICKET' }, { status: 409 })
    })
    await openAsStaff()

    await userEvent.selectOptions(workflow().getByLabelText('IT Priority'), 'URGENT')

    expect(await workflow().findByText(STALE)).toBeInTheDocument()
    await waitFor(() => expect(workflow().getByLabelText('IT Priority')).toHaveValue('HIGH'))
  })

  it('shows the gate\'s reason when the server refuses a move the screen thought was open', async () => {
    // The screen loaded with the gate met. A colleague then recorded an
    // action that needs follow-up, and the server refuses.
    mockApi(() => {
      server = { ...BASE, transitions: moves(FOLLOW_UP) }
      return Response.json({ error: FOLLOW_UP, code: 'RESOLUTION_GATE' }, { status: 409 })
    })
    await openAsStaff()

    await userEvent.selectOptions(moveTo(), 'RESOLVED')
    await userEvent.click(workflow().getByRole('button', { name: 'Change status' }))

    const alert = await workflow().findByRole('alert')
    expect(alert).toHaveTextContent(FOLLOW_UP)
    // And after the reload the option itself is disabled, with the same reason.
    await waitFor(() => expect(option(/^Resolved/)).toBeDisabled())
    expect(workflow().getByTestId('blocked-RESOLVED')).toHaveTextContent(FOLLOW_UP)
    expect(summary().getByText('In Progress')).toBeInTheDocument()
  })

  it('says nothing the server did not say when the failure is not a refusal', async () => {
    mockApi(() => Response.json({ error: 'relation "Ticket" does not exist' }, { status: 500 }))
    await openAsStaff()

    await userEvent.selectOptions(moveTo(), 'CANCELLED')
    await userEvent.click(workflow().getByRole('button', { name: 'Change status' }))

    expect(await workflow().findByText('That change could not be saved. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/relation/)).not.toBeInTheDocument()
  })
})

describe('UI-15 the Requester has no status control (BR-15, AC-24)', () => {
  it('shows the status and the advisory button, and nothing that changes the status', async () => {
    signedIn = authUser(PETER)
    mockApi()
    window.history.pushState({}, '', '/tickets/42')
    await renderApp()
    await screen.findByRole('heading', { name: 'TKT-2026-000042' })

    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /problem appears resolved/i })).toBeInTheDocument()

    expect(screen.queryByRole('region', { name: 'Workflow' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Move to')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /change status/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(sent).toEqual([])
  })
})
