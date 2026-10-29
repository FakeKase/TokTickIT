import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { StaffTicketDetail, TicketComment } from '../../src/api'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'

// UI-14 to UI-16 (AC-27, AC-28, AC-30, AC-31, AC-45; BR-04, BR-22, BR-23).
//
// The mock answers each PATCH the way the server does: with the whole updated
// Ticket. So what a test sees after a click is what the screen made of a real
// response, not a state the test put there itself.

const SARAH = { id: 9, name: 'Sarah Chen', role: 'IT_STAFF' as const }
let signedIn = authUser(SARAH)

const BASE: StaffTicketDetail = {
  id: 42,
  ticketNumber: 'TKT-2026-000042',
  summary: 'Laptop will not start',
  description: 'Nothing happens when the power button is pressed.',
  category: { id: 10, name: 'Hardware' },
  relatedSystem: { id: 20, name: 'Corporate Laptop' },
  requester: { id: 1, name: 'Peter Parker' },
  owner: null,
  requestedPriority: 'LOW',
  itPriority: 'MEDIUM',
  currentStatus: 'IN_PROGRESS',
  requesterResolvedAt: null,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-02T09:00:00.000Z',
  attachments: [],
  transitions: [
    { to: 'WAITING_FOR_REQUESTER', requiresOwner: false, blockedReason: null },
    { to: 'RESOLVED', requiresOwner: true, blockedReason: null },
    { to: 'CANCELLED', requiresOwner: false, blockedReason: null },
  ],
  ownerRequired: false,
  // Lab 4: every workflow change names the version it was based on.
  version: 1,
  resolvedAt: null,
}

/**
 * The Ticket as the server would send it (Lab 4 api-spec.md §4): each move
 * says whether it would be refused right now. These tests are about the Lab 3
 * rules, so the only reason modelled is the one Lab 3 had, a missing Ticket
 * Owner. The resolution gate is covered in lab-04/TicketWorkflow.test.tsx.
 */
const served = (ticket: StaffTicketDetail): StaffTicketDetail => ({
  ...ticket,
  transitions: ticket.transitions.map((move) => ({
    ...move,
    blockedReason:
      move.requiresOwner && !ticket.owner
        ? `A Ticket needs a Ticket Owner before it can be ${move.to === 'CLOSED' ? 'Closed' : 'Resolved'}`
        : null,
  })),
})

const ASSIGNABLE = [
  { id: 2, name: 'Ada Admin', role: 'ADMINISTRATOR' },
  { id: 11, name: 'Marcus Reed', role: 'IT_STAFF' },
  { id: 9, name: 'Sarah Chen', role: 'IT_STAFF' },
]

const comment = (id: number, body: string, visibility: 'PUBLIC' | 'INTERNAL'): TicketComment => ({
  id,
  ticketId: 42,
  visibility,
  body,
  author: { id: 9, name: 'Sarah Chen', role: 'IT_STAFF' },
  createdAt: '2026-09-02T10:00:00.000Z',
})

interface Sent {
  method: string
  path: string
  body: Record<string, unknown>
}

/** Every write the screen made. */
let sent: Sent[] = []
/** The Ticket as the mock server holds it; PATCH handlers replace it. */
let server: StaffTicketDetail

interface Handlers {
  ticket?: () => Response | Promise<Response>
  patch?: (what: string, body: Record<string, unknown>) => Response | Promise<Response> | undefined
  comments?: () => Response | Promise<Response>
  post?: (body: Record<string, unknown>) => Response | Promise<Response>
  assignable?: () => Response | Promise<Response>
}

function mockApi(handlers: Handlers = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const auth = authRoutes(signedIn)(url)
    if (auth) return auth

    const method = init?.method ?? 'GET'
    const path = new URL(url, 'http://localhost').pathname
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (method !== 'GET') sent.push({ method, path, body })

    const answer = (value: Response | Promise<Response>) => Promise.resolve(value)

    if (path.endsWith('/assignable-users')) {
      return answer(handlers.assignable?.() ?? Response.json(ASSIGNABLE))
    }
    if (path.endsWith('/comments')) {
      if (method === 'POST') {
        return answer(
          handlers.post?.(body) ??
            Response.json(
              comment(99, String(body.body), body.visibility as 'PUBLIC' | 'INTERNAL'),
              { status: 201 },
            ),
        )
      }
      return answer(handlers.comments?.() ?? Response.json([]))
    }

    const patched = /\/api\/staff\/tickets\/\d+\/(owner|it-priority|status)$/.exec(path)
    if (patched && method === 'PATCH') {
      const custom = handlers.patch?.(patched[1], body)
      if (custom) return answer(custom)

      // The default server: applies the change and returns the whole Ticket.
      // A real change raises the version, as on the server.
      server = { ...server, version: server.version + 1 }
      if (patched[1] === 'owner') {
        const owner = ASSIGNABLE.find((user) => user.id === body.ownerId)
        server = { ...server, owner: owner ? { id: owner.id, name: owner.name } : null }
      }
      if (patched[1] === 'it-priority') {
        server = { ...server, itPriority: body.itPriority as StaffTicketDetail['itPriority'] }
      }
      if (patched[1] === 'status') {
        server = {
          ...server,
          currentStatus: body.currentStatus as StaffTicketDetail['currentStatus'],
          transitions: [{ to: 'CLOSED', requiresOwner: true, blockedReason: null }, { to: 'REOPENED', requiresOwner: false, blockedReason: null }],
        }
      }
      return answer(Response.json(served(server)))
    }

    if (/\/api\/staff\/tickets\/\d+$/.test(path)) {
      return answer(handlers.ticket?.() ?? Response.json(served(server)))
    }
    if (path === '/api/staff/tickets') {
      // The queue, for the one test that arrives from it.
      return answer(
        Response.json({
          data: [server],
          pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
          filtered: true,
        }),
      )
    }
    return answer(Response.json([]))
  }) as typeof fetch)
}

const open = async (path = '/staff/tickets/42') => {
  window.history.pushState({}, '', path)
  await renderApp()
}

const openTicket = async () => {
  await open()
  await screen.findByRole('heading', { name: 'TKT-2026-000042' })
}

const workflow = () => within(screen.getByRole('region', { name: 'Workflow' }))
const refused = (error: string) => Response.json({ error }, { status: 409 })

beforeEach(() => {
  vi.restoreAllMocks()
  signedIn = authUser(SARAH)
  server = { ...BASE }
  sent = []
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('the Ticket itself is read-only (FR-14)', () => {
  it('shows the facts of the Ticket with no control that edits them', async () => {
    mockApi()
    await openTicket()

    expect(screen.getByText('Laptop will not start')).toBeInTheDocument()
    expect(screen.getByText('Nothing happens when the power button is pressed.')).toBeInTheDocument()
    expect(screen.getByText('Peter Parker')).toBeInTheDocument()
    expect(screen.getByText('Corporate Laptop')).toBeInTheDocument()

    // Every editable control on the screen lives in the workflow panel or a
    // composer. None of them edits the summary, description or requester.
    for (const name of [/summary/i, /description/i, /requester$/i, /category/i]) {
      expect(screen.queryByRole('textbox', { name })).toBeNull()
      expect(screen.queryByRole('combobox', { name })).toBeNull()
    }
  })

  it('shows Requested Priority beside IT Priority, and offers no way to change it', async () => {
    server = { ...BASE, requestedPriority: 'HIGH', itPriority: 'LOW' }
    mockApi()
    await openTicket()

    expect(screen.getByTestId('requested-priority')).toHaveTextContent('High')
    expect(workflow().getByLabelText('IT Priority')).toHaveValue('LOW')
    expect(screen.queryByLabelText('Requested Priority')).toBeNull()
  })

  it('shows the Requester’s resolved signal when there is one, and not otherwise', async () => {
    mockApi()
    await openTicket()
    expect(screen.queryByText(/reported this appears resolved/i)).toBeNull()
  })

  it('tells staff the Requester reported the problem resolved', async () => {
    server = { ...BASE, requesterResolvedAt: '2026-09-03T08:00:00.000Z' }
    mockApi()
    await openTicket()

    expect(workflow().getByText(/The Requester reported this appears resolved on/)).toBeInTheDocument()
  })
})

describe('UI-14 ownership (AC-27, AC-28)', () => {
  it('offers Claim on an unassigned Ticket and sends the acting user as the owner', async () => {
    mockApi()
    await openTicket()
    expect(screen.getByTestId('owner-current')).toHaveTextContent('Unassigned')
    // Nothing to unassign yet.
    expect(workflow().queryByRole('button', { name: 'Unassign' })).toBeNull()

    const user = userEvent.setup()
    await user.click(workflow().getByRole('button', { name: 'Claim' }))

    await waitFor(() => expect(screen.getByTestId('owner-current')).toHaveTextContent('Sarah Chen (you)'))
    expect(sent).toEqual([
      { method: 'PATCH', path: '/api/staff/tickets/42/owner', body: { ownerId: 9, expectedVersion: 1 } },
    ])
    // Already theirs, so there is nothing left to claim.
    expect(workflow().queryByRole('button', { name: 'Claim' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('You are now the Ticket Owner.')
  })

  it('offers Claim when a colleague holds the Ticket', async () => {
    server = { ...BASE, owner: { id: 11, name: 'Marcus Reed' } }
    mockApi()
    await openTicket()

    expect(screen.getByTestId('owner-current')).toHaveTextContent('Marcus Reed')
    expect(workflow().getByRole('button', { name: 'Claim' })).toBeInTheDocument()
  })

  it('lists the assignable users for reassignment, leaving out the current owner', async () => {
    server = { ...BASE, owner: { id: 11, name: 'Marcus Reed' } }
    mockApi()
    await openTicket()

    const select = workflow().getByLabelText('Reassign to')
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3))

    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Choose a colleague…',
      'Ada Admin (Administrator)',
      'Sarah Chen (IT Staff)',
    ])
  })

  it('reassigns to the colleague chosen', async () => {
    mockApi()
    await openTicket()
    const select = workflow().getByLabelText('Reassign to')
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1))

    const user = userEvent.setup()
    await user.selectOptions(select, '11')

    await waitFor(() => expect(screen.getByTestId('owner-current')).toHaveTextContent('Marcus Reed'))
    expect(sent[0]).toEqual({
      method: 'PATCH',
      path: '/api/staff/tickets/42/owner',
      body: { ownerId: 11, expectedVersion: 1 },
    })
    expect(screen.getByRole('status')).toHaveTextContent('Ticket Owner is now Marcus Reed.')
  })

  it('unassigns with a null owner', async () => {
    server = { ...BASE, owner: { id: 9, name: 'Sarah Chen' } }
    mockApi()
    await openTicket()

    const user = userEvent.setup()
    await user.click(workflow().getByRole('button', { name: 'Unassign' }))

    await waitFor(() => expect(screen.getByTestId('owner-current')).toHaveTextContent('Unassigned'))
    expect(sent[0].body).toEqual({ ownerId: null, expectedVersion: 1 })
  })

  it('disables Unassign on a Ticket that must keep its owner, and says why', async () => {
    server = {
      ...BASE,
      currentStatus: 'RESOLVED',
      owner: { id: 9, name: 'Sarah Chen' },
      ownerRequired: true,
      transitions: [],
    }
    mockApi()
    await openTicket()

    const unassign = workflow().getByRole('button', { name: 'Unassign' })
    expect(unassign).toBeDisabled()
    expect(unassign).toHaveAccessibleDescription(/Resolved Ticket must keep its Ticket Owner/)
    // Handing it to a colleague is still allowed, and still offered.
    expect(workflow().getByLabelText('Reassign to')).toBeEnabled()
  })

  it('shows the server’s reason when an owner change is refused, and reloads the Ticket', async () => {
    let loads = 0
    mockApi({
      ticket: () => {
        loads += 1
        return Response.json(server)
      },
      patch: () => {
        // Deactivated a moment ago, in another window.
        server = { ...server, summary: 'Laptop will not start (updated)' }
        return refused('Ticket Owner must be an active IT Staff or Administrator')
      },
    })
    await openTicket()
    const select = workflow().getByLabelText('Reassign to')
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1))

    const user = userEvent.setup()
    await user.selectOptions(select, '11')

    expect(await workflow().findByRole('alert')).toHaveTextContent(
      'Ticket Owner must be an active IT Staff or Administrator',
    )
    expect(screen.getByTestId('owner-current')).toHaveTextContent('Unassigned')
    // Refused means this screen was behind, so it catches up.
    expect(await screen.findByText('Laptop will not start (updated)')).toBeInTheDocument()
    expect(loads).toBe(2)
  })

  it('still works when the assignable list cannot be loaded', async () => {
    mockApi({ assignable: () => Response.json({ error: 'nope' }, { status: 500 }) })
    await openTicket()

    const user = userEvent.setup()
    await user.click(workflow().getByRole('button', { name: 'Claim' }))

    await waitFor(() => expect(screen.getByTestId('owner-current')).toHaveTextContent('Sarah Chen'))
  })
})

describe('UI-15 IT Priority (AC-30)', () => {
  it('saves on change and leaves Requested Priority alone', async () => {
    mockApi()
    await openTicket()

    const user = userEvent.setup()
    await user.selectOptions(workflow().getByLabelText('IT Priority'), 'URGENT')

    await waitFor(() => expect(workflow().getByLabelText('IT Priority')).toHaveValue('URGENT'))
    expect(sent).toEqual([
      { method: 'PATCH', path: '/api/staff/tickets/42/it-priority', body: { itPriority: 'URGENT', expectedVersion: 1 } },
    ])
    expect(screen.getByTestId('requested-priority')).toHaveTextContent('Low')
    expect(screen.getByRole('status')).toHaveTextContent('IT Priority set to Urgent.')
  })

  it('goes back to the saved value when the save fails, and says so', async () => {
    mockApi({ patch: () => Response.json({ error: 'boom: relation "Ticket"' }, { status: 500 }) })
    await openTicket()

    const user = userEvent.setup()
    await user.selectOptions(workflow().getByLabelText('IT Priority'), 'URGENT')

    const alert = await workflow().findByRole('alert')
    expect(alert).toHaveTextContent('That change could not be saved. Please try again.')
    // A 500's wording is the server's business, not the user's.
    expect(alert).not.toHaveTextContent(/boom|relation/)
    expect(workflow().getByLabelText('IT Priority')).toHaveValue('MEDIUM')
  })

  it('shows a saving indicator while the request is out', async () => {
    let release: (response: Response) => void = () => {}
    mockApi({ patch: () => new Promise<Response>((resolve) => (release = resolve)) })
    await openTicket()

    const user = userEvent.setup()
    await user.selectOptions(workflow().getByLabelText('IT Priority'), 'HIGH')

    expect(await workflow().findByText('Saving…')).toBeInTheDocument()
    // One change at a time: the other controls wait.
    expect(workflow().getByRole('button', { name: 'Claim' })).toBeDisabled()

    release(Response.json({ ...BASE, itPriority: 'HIGH' }))
    await waitFor(() => expect(workflow().queryByText('Saving…')).toBeNull())
  })
})

describe('UI-15 status (AC-31, AC-32, AC-33; BR-22, BR-23)', () => {
  const options = () =>
    within(workflow().getByLabelText('Move to'))
      .getAllByRole('option')
      .map((option) => option.textContent)

  it('offers only the moves the server says are permitted from here', async () => {
    server = { ...BASE, owner: { id: 9, name: 'Sarah Chen' } }
    mockApi()
    await openTicket()

    expect(options()).toEqual(['Choose a status…', 'Waiting for Requester', 'Resolved', 'Cancelled'])
    // Closed is not reachable from In Progress, so it is not offered at all.
    expect(options()).not.toContain('Closed')
  })

  it('takes its options from the response, not from a matrix of its own', async () => {
    server = {
      ...BASE,
      currentStatus: 'CLOSED',
      owner: { id: 9, name: 'Sarah Chen' },
      transitions: [{ to: 'REOPENED', requiresOwner: false, blockedReason: null }],
    }
    mockApi()
    await openTicket()

    expect(options()).toEqual(['Choose a status…', 'Reopened'])
  })

  it('disables Resolved on an unowned Ticket and says why (AC-33)', async () => {
    mockApi()
    await openTicket()

    const resolved = within(workflow().getByLabelText('Move to')).getByRole('option', {
      name: 'Resolved (needs a Ticket Owner)',
    })
    expect(resolved).toBeDisabled()
    expect(workflow().getByText(/needs a Ticket Owner before it can be Resolved or Closed/)).toBeInTheDocument()
    // Cancelling needs nobody, so it stays available.
    expect(within(workflow().getByLabelText('Move to')).getByRole('option', { name: 'Cancelled' })).toBeEnabled()
  })

  it('enables Resolved once the Ticket is claimed', async () => {
    mockApi()
    await openTicket()

    const user = userEvent.setup()
    await user.click(workflow().getByRole('button', { name: 'Claim' }))

    await waitFor(() =>
      expect(
        within(workflow().getByLabelText('Move to')).getByRole('option', { name: 'Resolved' }),
      ).toBeEnabled(),
    )
    expect(workflow().queryByText(/needs a Ticket Owner before/)).toBeNull()
  })

  it('changes nothing until the button is pressed', async () => {
    server = { ...BASE, owner: { id: 9, name: 'Sarah Chen' } }
    mockApi()
    await openTicket()
    expect(workflow().getByRole('button', { name: 'Change status' })).toBeDisabled()

    const user = userEvent.setup()
    await user.selectOptions(workflow().getByLabelText('Move to'), 'CANCELLED')

    // Choosing is not doing. Cancelled cannot be undone, so it takes a
    // second, deliberate step.
    expect(sent).toEqual([])
    expect(workflow().getByRole('button', { name: 'Change status' })).toBeEnabled()
  })

  it('moves the Ticket and offers the next set of moves (AC-32)', async () => {
    server = { ...BASE, owner: { id: 9, name: 'Sarah Chen' } }
    mockApi()
    await openTicket()

    const user = userEvent.setup()
    await user.selectOptions(workflow().getByLabelText('Move to'), 'RESOLVED')
    await user.click(workflow().getByRole('button', { name: 'Change status' }))

    await waitFor(() => expect(options()).toEqual(['Choose a status…', 'Closed', 'Reopened']))
    expect(sent).toEqual([
      { method: 'PATCH', path: '/api/staff/tickets/42/status', body: { currentStatus: 'RESOLVED', expectedVersion: 1 } },
    ])
    expect(screen.getByRole('status')).toHaveTextContent('Status changed to Resolved.')
    // The selection is spent. Were it kept, the button would stay armed with
    // a status chosen for a Ticket that has since moved on.
    expect(workflow().getByLabelText('Move to')).toHaveValue('')
    expect(workflow().getByRole('button', { name: 'Change status' })).toBeDisabled()
  })

  it('shows the conflict message and puts the control back when a move is refused (AC-31)', async () => {
    server = { ...BASE, owner: { id: 9, name: 'Sarah Chen' } }
    mockApi({
      patch: () => {
        // A colleague cancelled it while this screen sat open.
        server = { ...server, currentStatus: 'CANCELLED', transitions: [] }
        return refused('Cannot move a Ticket from Cancelled to Resolved')
      },
    })
    await openTicket()

    const user = userEvent.setup()
    await user.selectOptions(workflow().getByLabelText('Move to'), 'RESOLVED')
    await user.click(workflow().getByRole('button', { name: 'Change status' }))

    expect(await workflow().findByRole('alert')).toHaveTextContent(
      'Cannot move a Ticket from Cancelled to Resolved',
    )
    // The screen has caught up: it now shows what the Ticket really is, and
    // offers nothing, because Cancelled is final.
    expect(await workflow().findByText(/Cancelled is final/)).toBeInTheDocument()
    expect(workflow().queryByLabelText('Move to')).toBeNull()
    expect(workflow().queryByRole('button', { name: 'Change status' })).toBeNull()
  })

  it('offers no move at all on a Cancelled Ticket', async () => {
    server = { ...BASE, currentStatus: 'CANCELLED', transitions: [] }
    mockApi()
    await openTicket()

    expect(workflow().getByText('Cancelled is final. This Ticket cannot be moved again.')).toBeInTheDocument()
    expect(workflow().queryByLabelText('Move to')).toBeNull()
  })
})

describe('UI-16 two conversation streams (BR-04, ui-spec §5)', () => {
  const stream = (title: string) =>
    within(screen.getByRole('heading', { name: title }).closest('.ttk-thread') as HTMLElement)

  it('puts each entry in its own stream, under a heading that names who reads it', async () => {
    mockApi({
      comments: () =>
        Response.json([
          comment(1, 'Could you try a different charger?', 'PUBLIC'),
          comment(2, 'Third one this month from this batch.', 'INTERNAL'),
        ]),
    })
    await openTicket()

    expect(await stream('Public Comments').findByText('Could you try a different charger?')).toBeInTheDocument()
    expect(stream('Public Comments').queryByText('Third one this month from this batch.')).toBeNull()
    expect(stream('Public Comments').getByText('Visible to the Requester.')).toBeInTheDocument()

    expect(stream('Internal Notes').getByText('Third one this month from this batch.')).toBeInTheDocument()
    expect(stream('Internal Notes').queryByText('Could you try a different charger?')).toBeNull()
    expect(stream('Internal Notes').getAllByText(/The Requester never sees these/).length).toBeGreaterThan(0)
  })

  it('has two composers with different labels and different buttons, and no visibility switch', async () => {
    mockApi()
    await openTicket()

    expect(screen.getByLabelText('Add a public comment')).toBeInTheDocument()
    expect(screen.getByLabelText('Add an internal note')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post comment' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add internal note' })).toBeInTheDocument()

    // No toggle, checkbox, radio or select that could flip one into the other.
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('combobox', { name: /visib/i })).toBeNull()
  })

  it('sends PUBLIC from the public composer and shows the entry there', async () => {
    mockApi()
    await openTicket()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Add a public comment'), 'We have ordered a replacement.')
    await user.click(screen.getByRole('button', { name: 'Post comment' }))

    expect(await stream('Public Comments').findByText('We have ordered a replacement.')).toBeInTheDocument()
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/api/tickets/42/comments',
        body: { body: 'We have ordered a replacement.', visibility: 'PUBLIC' },
      },
    ])
    expect(stream('Internal Notes').queryByText('We have ordered a replacement.')).toBeNull()
  })

  it('sends INTERNAL from the internal composer and shows the entry there', async () => {
    mockApi()
    await openTicket()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Add an internal note'), 'Vendor ticket 8841.')
    await user.click(screen.getByRole('button', { name: 'Add internal note' }))

    expect(await stream('Internal Notes').findByText('Vendor ticket 8841.')).toBeInTheDocument()
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/api/tickets/42/comments',
        body: { body: 'Vendor ticket 8841.', visibility: 'INTERNAL' },
      },
    ])
    expect(stream('Public Comments').queryByText('Vendor ticket 8841.')).toBeNull()
  })

  it('keeps the two drafts apart: posting one neither sends nor clears the other', async () => {
    mockApi()
    await openTicket()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Add an internal note'), 'Do not tell them yet.')
    await user.type(screen.getByLabelText('Add a public comment'), 'Looking into it.')
    await user.click(screen.getByRole('button', { name: 'Post comment' }))

    await stream('Public Comments').findByText('Looking into it.')
    expect(sent).toHaveLength(1)
    expect(JSON.stringify(sent)).not.toContain('Do not tell them yet.')
    expect(screen.getByLabelText('Add an internal note')).toHaveValue('Do not tell them yet.')
    expect(screen.getByLabelText('Add a public comment')).toHaveValue('')
  })

  it('renders a body as text, so stored markup stays inert (BR-28)', async () => {
    mockApi({ comments: () => Response.json([comment(1, '<img src=x onerror=alert(1)>', 'INTERNAL')]) })
    await openTicket()

    expect(await stream('Internal Notes').findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('fails the streams on their own, leaving the Ticket and the workflow usable', async () => {
    mockApi({ comments: () => Response.json({ error: 'nope' }, { status: 500 }) })
    await openTicket()

    expect((await screen.findAllByText('Comments could not be loaded')).length).toBe(2)
    expect(workflow().getByRole('button', { name: 'Claim' })).toBeEnabled()
  })
})

describe('AC-45 attachments are read-only for staff', () => {
  it('lists them with a download and no way to add or remove one', async () => {
    server = {
      ...BASE,
      attachments: [
        { id: 5, originalFilename: 'photo.png', mimeType: 'image/png', sizeBytes: 2048, isRemoved: false, removedAt: null, removedReason: null, createdAt: '2026-09-01T09:00:00.000Z' },
        { id: 6, originalFilename: 'old.pdf', mimeType: 'application/pdf', sizeBytes: 1024, isRemoved: true, removedAt: '2026-09-02T09:00:00.000Z', removedReason: 'Wrong file', createdAt: '2026-09-01T09:00:00.000Z' },
      ],
    }
    mockApi()
    await openTicket()

    expect(screen.getByText('photo.png')).toBeInTheDocument()
    const downloads = screen.getAllByRole('link', { name: 'Download' })
    // One link: the removed file keeps its row and its reason, but no download.
    expect(downloads).toHaveLength(1)
    expect(downloads[0].getAttribute('href')).toContain('/api/attachments/5/download')
    expect(screen.getByText('old.pdf')).toBeInTheDocument()
    expect(screen.getByText(/Wrong file/)).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })
})

describe('loading, missing, forbidden and failed', () => {
  it('says the Ticket was not found, with no Retry, for a 404 and for an id that is not a number', async () => {
    mockApi({ ticket: () => Response.json({ error: 'Ticket not found' }, { status: 404 }) })
    await open()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Ticket not found')
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('does not even ask the server about an id that is not a number', async () => {
    let asked = 0
    mockApi({
      ticket: () => {
        asked += 1
        return Response.json(server)
      },
    })
    await open('/staff/tickets/abc')

    expect(await screen.findByRole('alert')).toHaveTextContent('Ticket not found')
    expect(asked).toBe(0)
  })

  it('offers a Retry that reloads after a failure, and repeats nothing the server said', async () => {
    let fail = true
    mockApi({
      ticket: () =>
        fail ? Response.json({ error: 'ECONNREFUSED 127.0.0.1:5433' }, { status: 500 }) : Response.json(server),
    })
    await open()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to load the Ticket')
    expect(alert).not.toHaveTextContent(/ECONNREFUSED|5433/)

    fail = false
    const user = userEvent.setup()
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'TKT-2026-000042' })).toBeInTheDocument()
  })

  it('shows Forbidden with a way home when the API refuses the role', async () => {
    mockApi({ ticket: () => Response.json({ error: 'Forbidden' }, { status: 403 }) })
    await open()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/do not have permission/i)
    expect(within(alert).getByRole('link', { name: /home page/i })).toBeInTheDocument()
  })

  it('never requests the Ticket for a Requester', async () => {
    signedIn = authUser({ role: 'REQUESTER' })
    let asked = 0
    mockApi({
      ticket: () => {
        asked += 1
        return Response.json(server)
      },
    })
    await open()

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not have permission/i)
    expect(asked).toBe(0)
  })

  it('gives an Administrator the same screen', async () => {
    signedIn = authUser({ id: 2, name: 'Ada Admin', role: 'ADMINISTRATOR' })
    mockApi()
    await openTicket()

    const user = userEvent.setup()
    await user.click(workflow().getByRole('button', { name: 'Claim' }))

    await waitFor(() => expect(screen.getByTestId('owner-current')).toHaveTextContent('Ada Admin (you)'))
    expect(sent[0].body).toEqual({ ownerId: 2, expectedVersion: 1 })
  })
})

describe('getting back to the queue', () => {
  it('returns to the view the Ticket was opened from, filters and all', async () => {
    mockApi()
    await open('/staff/tickets?status=IN_PROGRESS&sortBy=itPriority')

    const user = userEvent.setup()
    await user.click(
      within(await screen.findByRole('table')).getByRole('link', { name: 'TKT-2026-000042' }),
    )

    const back = await screen.findByRole('link', { name: /Back to Ticket Queue/ })
    expect(back).toHaveAttribute('href', '/staff/tickets?status=IN_PROGRESS&sortBy=itPriority')
  })

  it('goes to the plain queue when the Ticket was opened directly', async () => {
    mockApi()
    await openTicket()

    expect(screen.getByRole('link', { name: /Back to Ticket Queue/ })).toHaveAttribute('href', '/staff/tickets')
  })
})
