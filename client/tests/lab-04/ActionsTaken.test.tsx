import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ActionTaken, StaffTicketDetail, TicketStatus } from '../../src/api'
import { toLocalInput } from '../../src/pages/actionValidation'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'

// UI-01 to UI-10 (Lab 4 AC-01, AC-03, AC-07, AC-09, AC-11 to AC-14, AC-42,
// AC-43; BR-08, BR-17, BR-20, BR-30, BR-31).
//
// The whole application is rendered and the API is answered the way the
// server answers it, so what a test sees is what the screen made of a real
// response. That a Requester cannot write is proved at the API, in
// server/tests/lab-04/actions-taken.api.test.ts; here it is only that the
// screen does not offer it.

const SARAH = { id: 9, name: 'Sarah Chen', role: 'IT_STAFF' as const }
const PETER = { id: 1, name: 'Peter Parker', role: 'REQUESTER' as const }
let signedIn = authUser(SARAH)

const STAFF_TICKET: StaffTicketDetail = {
  id: 42,
  ticketNumber: 'TKT-2026-000042',
  summary: 'Projector will not power on',
  description: 'The lecture theatre projector shows no light.',
  category: { id: 10, name: 'Hardware' },
  relatedSystem: { id: 20, name: 'Corporate Laptop' },
  requester: { id: 1, name: 'Peter Parker' },
  owner: { id: 11, name: 'Marcus Reed' },
  requestedPriority: 'LOW',
  itPriority: 'MEDIUM',
  currentStatus: 'IN_PROGRESS',
  requesterResolvedAt: null,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-02T09:00:00.000Z',
  attachments: [],
  transitions: [{ to: 'WAITING_FOR_REQUESTER', requiresOwner: false }],
  ownerRequired: false,
}

const action = (overrides: Partial<ActionTaken> = {}): ActionTaken => ({
  id: 12,
  ticketId: 42,
  actionAt: '2026-09-03T03:15:00.000Z',
  description: 'Replaced the projector lamp in LX-204.',
  result: 'Projector powers on and holds an image.',
  followUpRequired: false,
  followUpNote: null,
  attachmentNotes: null,
  performedBy: { id: 11, name: 'Marcus Reed' },
  createdAt: '2026-09-03T03:20:00.000Z',
  editedBy: null,
  editedAt: null,
  version: 1,
  ...overrides,
})

const NEWER = action({
  id: 13,
  actionAt: '2026-09-04T02:00:00.000Z',
  description: 'Checked lamp hours after one day of lectures.',
  result: 'Hours are counting normally.',
  followUpRequired: true,
  followUpNote: 'Check again after one week.',
  attachmentNotes: 'Photo of the lamp label: lamp-lx204.jpg',
  performedBy: { id: 9, name: 'Sarah Chen' },
  editedBy: { id: 11, name: 'Marcus Reed' },
  editedAt: '2026-09-04T05:00:00.000Z',
  version: 2,
})
const OLDER = action()

interface Sent {
  method: string
  path: string
  body: Record<string, unknown>
}

/** Every write the screen made, and how often each thing was read. */
let sent: Sent[] = []
let reads = { ticket: 0, actions: 0 }
/** What the mock server holds. */
let serverActions: ActionTaken[] = []
let ticketStatus: TicketStatus = 'IN_PROGRESS'

type Answer = Response | Promise<Response>

interface Handlers {
  list?: () => Answer
  create?: (body: Record<string, unknown>) => Answer
  edit?: (id: number, body: Record<string, unknown>) => Answer
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
    const answer = (value: Answer) => Promise.resolve(value)

    const edited = /\/api\/tickets\/42\/actions\/(\d+)$/.exec(path)
    if (edited && method === 'PATCH') {
      const id = Number(edited[1])
      const custom = handlers.edit?.(id, body)
      if (custom) return answer(custom)
      // The default server: applies the edit as the real one does.
      serverActions = serverActions.map((existing) =>
        existing.id === id
          ? ({
              ...existing,
              ...body,
              version: existing.version + 1,
              editedBy: { id: signedIn.id, name: signedIn.name },
              editedAt: '2026-10-01T00:00:00.000Z',
            } as ActionTaken)
          : existing,
      )
      return answer(Response.json(serverActions.find((existing) => existing.id === id)))
    }

    if (path === '/api/tickets/42/actions') {
      if (method === 'POST') {
        const custom = handlers.create?.(body)
        if (custom) return answer(custom)
        const created = action({
          ...(body as Partial<ActionTaken>),
          id: 99,
          performedBy: { id: signedIn.id, name: signedIn.name },
        })
        serverActions = [created, ...serverActions]
        return answer(Response.json(created, { status: 201 }))
      }
      reads.actions += 1
      return answer(handlers.list?.() ?? Response.json(serverActions))
    }

    if (path.endsWith('/comments') || path.endsWith('/assignable-users')) {
      return answer(Response.json([]))
    }
    if (path === '/api/staff/tickets/42') {
      reads.ticket += 1
      return answer(Response.json({ ...STAFF_TICKET, currentStatus: ticketStatus }))
    }
    if (path === '/api/tickets/42') {
      reads.ticket += 1
      // The Requester's view of the same Ticket.
      return answer(
        Response.json({
          ...STAFF_TICKET,
          currentStatus: ticketStatus,
          requester: { id: 1, name: 'Peter Parker' },
        }),
      )
    }
    return answer(Response.json([]))
  }) as typeof fetch)
}

const openAsStaff = async () => {
  window.history.pushState({}, '', '/staff/tickets/42')
  await renderApp()
  await screen.findByRole('heading', { name: 'TKT-2026-000042' })
}

const openAsRequester = async () => {
  signedIn = authUser(PETER)
  window.history.pushState({}, '', '/tickets/42')
  await renderApp()
  await screen.findByRole('heading', { name: 'TKT-2026-000042' })
}

/** The Actions Taken area, found by its heading like a person would. */
const section = () => {
  const heading = screen.getByRole('heading', { name: 'Actions Taken' })
  return within(heading.closest('.ttk-actions') as HTMLElement)
}
const table = () => within(section().getByRole('table'))
/** The same, for the first look at it: waits for the list to have loaded. */
const loadedTable = async () => within(await section().findByRole('table'))
const dialog = () => within(screen.getByRole('dialog'))

const openCreate = async () => {
  await userEvent.click(await section().findByRole('button', { name: 'Add Action Taken' }))
  return dialog()
}

/** Fills the two required text fields; the date is already there. */
const fillRequired = async () => {
  await userEvent.type(dialog().getByLabelText(/^Action Description/), 'Reseated the HDMI cable.')
  await userEvent.type(dialog().getByLabelText(/^Result/), 'Image is stable.')
}

beforeEach(() => {
  vi.restoreAllMocks()
  signedIn = authUser(SARAH)
  sent = []
  reads = { ticket: 0, actions: 0 }
  serverActions = [NEWER, OLDER]
  ticketStatus = 'IN_PROGRESS'
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('UI-01 the list (FR-01, AC-03)', () => {
  it('shows the rows in the order the server sent them, with every list column', async () => {
    mockApi()
    await openAsStaff()

    const rows = await (await loadedTable()).findAllByRole('row')
    // Header, then newest first as served. The screen does not re-sort.
    expect(rows).toHaveLength(3)
    expect(
      within(rows[0])
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Action Date/Time', 'Action Description', 'Result', 'Performed by', 'Follow-up', 'View'])

    expect(within(rows[1]).getByText(NEWER.description)).toBeInTheDocument()
    expect(within(rows[1]).getByText(NEWER.result)).toBeInTheDocument()
    expect(within(rows[1]).getByText(/Sarah Chen/)).toBeInTheDocument()
    expect(within(rows[2]).getByText(OLDER.description)).toBeInTheDocument()
    expect(within(rows[2]).getByText(/Marcus Reed/)).toBeInTheDocument()
  })

  it('says how many there are, states follow-up in words, and marks an edited row', async () => {
    mockApi()
    await openAsStaff()

    const rows = await (await loadedTable()).findAllByRole('row')
    expect(section().getByText('2 Actions Taken')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Follow-up required')).toBeInTheDocument()
    expect(within(rows[2]).getByText('No follow-up')).toBeInTheDocument()
    expect(within(rows[1]).getByText(/^Edited by Marcus Reed,/)).toBeInTheDocument()
    expect(within(rows[2]).queryByText(/Edited by/)).not.toBeInTheDocument()
  })

  it('counts a single one in the singular', async () => {
    serverActions = [OLDER]
    mockApi()
    await openAsStaff()

    expect(await section().findByText('1 Action Taken')).toBeInTheDocument()
  })

  it('tells staff the work is visible to the Requester', async () => {
    mockApi()
    await openAsStaff()

    expect(section().getByText('Work recorded on this Ticket. Visible to the Requester.')).toBeInTheDocument()
  })
})

describe('UI-02 the states of the section (FR-17)', () => {
  it('shows a spinner while loading, without holding up the Ticket', async () => {
    mockApi({ list: () => new Promise<Response>(() => {}) })
    await openAsStaff()

    expect(section().getByText('Loading the Actions Taken…')).toBeInTheDocument()
    // The rest of the Ticket is already there.
    expect(screen.getByRole('heading', { name: 'Workflow' })).toBeInTheDocument()
    expect(section().queryByRole('button', { name: 'Add Action Taken' })).not.toBeInTheDocument()
  })

  it('shows the empty line, and still offers to add one', async () => {
    serverActions = []
    mockApi()
    await openAsStaff()

    expect(
      await section().findByText('No Actions Taken have been recorded for this Ticket yet.'),
    ).toBeInTheDocument()
    expect(section().queryByRole('table')).not.toBeInTheDocument()
    expect(section().getByRole('button', { name: 'Add Action Taken' })).toBeInTheDocument()
  })

  it.each([
    ['a server error', () => Response.json({ error: 'Unable to load the Actions Taken' }, { status: 500 })],
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a body that is not a list', () => Response.json({ data: [] })],
  ])('reports %s here only, and retries only this section', async (_what, failing) => {
    let fail = true
    mockApi({ list: () => (fail ? failing() : Response.json(serverActions)) })
    await openAsStaff()

    expect(await section().findByText('Unable to load the Actions Taken')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Workflow' })).toBeInTheDocument()
    const ticketReads = reads.ticket

    fail = false
    await userEvent.click(section().getByRole('button', { name: 'Try again' }))

    expect(await section().findByText('2 Actions Taken')).toBeInTheDocument()
    expect(reads.ticket).toBe(ticketReads)
  })
})

describe('UI-03 the Requester sees the work, read-only (FR-04, AC-03)', () => {
  it('lists every Action Taken and offers no way to add one', async () => {
    mockApi()
    await openAsRequester()

    expect(await section().findByText('2 Actions Taken')).toBeInTheDocument()
    expect(section().getByText('Work IT Staff have recorded on your Ticket.')).toBeInTheDocument()
    expect(table().getByText(NEWER.description)).toBeInTheDocument()
    expect(table().getByText(OLDER.description)).toBeInTheDocument()
    expect(section().queryByRole('button', { name: 'Add Action Taken' })).not.toBeInTheDocument()
  })

  it('shows all seven fields in the view dialog, and no Edit', async () => {
    mockApi()
    await openAsRequester()

    await userEvent.click((await (await loadedTable()).findAllByRole('button', { name: /^View the Action Taken by Sarah Chen/ }))[0])

    const view = dialog()
    const value = (label: string) => view.getByText(label).nextElementSibling
    expect(view.getByRole('heading', { name: 'Action Taken' })).toBeInTheDocument()
    expect(value('Action Date/Time')).not.toBeEmptyDOMElement()
    expect(value('Action Description')).toHaveTextContent(NEWER.description)
    expect(value('Result')).toHaveTextContent(NEWER.result)
    expect(value('Performed by')).toHaveTextContent('Sarah Chen')
    expect(value('Follow-Up Required?')).toHaveTextContent('Follow-up required')
    expect(value('Follow-up Note')).toHaveTextContent('Check again after one week.')
    expect(value('Attachment Notes')).toHaveTextContent('Photo of the lamp label: lamp-lx204.jpg')

    expect(view.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(view.queryByRole('textbox')).not.toBeInTheDocument()
    expect(sent).toEqual([])
  })

  it('makes no write request of any kind', async () => {
    mockApi()
    await openAsRequester()
    await section().findByText('2 Actions Taken')

    expect(sent).toEqual([])
  })
})

describe('UI-04 recording an Action Taken (FR-02, AC-01)', () => {
  it('offers the current time, and the follow-up note only once follow-up is ticked', async () => {
    mockApi()
    await openAsStaff()
    const before = toLocalInput(new Date())

    const form = await openCreate()

    const when = form.getByLabelText(/^Action Date\/Time/) as HTMLInputElement
    expect([before, toLocalInput(new Date())]).toContain(when.value)
    expect(form.getByText('Sarah Chen (you)')).toBeInTheDocument()

    expect(form.queryByLabelText(/^Follow-up Note/)).not.toBeInTheDocument()
    await userEvent.click(form.getByLabelText('Follow-Up Required?'))
    expect(form.getByLabelText(/^Follow-up Note/)).toBeInTheDocument()
    await userEvent.click(form.getByLabelText('Follow-Up Required?'))
    expect(form.queryByLabelText(/^Follow-up Note/)).not.toBeInTheDocument()
  })

  it('sends a request key and the six fields, and no performer', async () => {
    mockApi()
    await openAsStaff()
    const form = await openCreate()

    fireEvent.change(form.getByLabelText(/^Action Date\/Time/), { target: { value: '2026-09-05T10:30' } })
    await userEvent.type(form.getByLabelText(/^Action Description/), '  Reseated the HDMI cable.  ')
    await userEvent.type(form.getByLabelText(/^Result/), 'Image is stable.')
    await userEvent.click(form.getByLabelText('Follow-Up Required?'))
    await userEvent.type(form.getByLabelText(/^Follow-up Note/), 'Replace the cable next week.')
    await userEvent.type(form.getByLabelText(/^Attachment Notes/), 'cable.jpg')
    await userEvent.click(form.getByRole('button', { name: 'Save Action Taken' }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ method: 'POST', path: '/api/tickets/42/actions' })
    expect(sent[0].body).toEqual({
      requestKey: expect.stringMatching(/^[A-Za-z0-9:_-]{8,64}$/),
      actionAt: new Date('2026-09-05T10:30').toISOString(),
      description: 'Reseated the HDMI cable.',
      result: 'Image is stable.',
      followUpRequired: true,
      followUpNote: 'Replace the cable next week.',
      attachmentNotes: 'cable.jpg',
    })
  })

  it('closes, reloads the list and the Ticket, and announces the save', async () => {
    mockApi()
    await openAsStaff()
    await section().findByText('2 Actions Taken')
    const before = { ...reads }
    await openCreate()

    await fillRequired()
    await userEvent.click(dialog().getByRole('button', { name: 'Save Action Taken' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await section().findByText('3 Actions Taken')).toBeInTheDocument()
    expect(table().getByText('Reseated the HDMI cable.')).toBeInTheDocument()
    expect(reads.actions).toBe(before.actions + 1)
    // The Ticket too: recording work moves its Last Updated.
    await waitFor(() => expect(reads.ticket).toBe(before.ticket + 1))
    // One polite region on the page, and it carries this.
    expect(screen.getByRole('status')).toHaveTextContent('Action Taken recorded.')
  })

  it('does not send a note that was typed and then un-ticked', async () => {
    mockApi()
    await openAsStaff()
    const form = await openCreate()

    await fillRequired()
    await userEvent.click(form.getByLabelText('Follow-Up Required?'))
    await userEvent.type(form.getByLabelText(/^Follow-up Note/), 'Changed my mind.')
    await userEvent.click(form.getByLabelText('Follow-Up Required?'))
    await userEvent.click(form.getByRole('button', { name: 'Save Action Taken' }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toMatchObject({ followUpRequired: false, followUpNote: null })
  })

  it('discards the form on Cancel and sends nothing', async () => {
    mockApi()
    await openAsStaff()
    await openCreate()

    await fillRequired()
    await userEvent.click(dialog().getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sent).toEqual([])
    // Opened again, it is a fresh form.
    const again = await openCreate()
    expect(again.getByLabelText(/^Action Description/)).toHaveValue('')
  })
})

describe('UI-05 validation (AC-07, AC-09)', () => {
  it('puts each message under its own field, tied to it, and sends nothing', async () => {
    mockApi()
    await openAsStaff()
    const form = await openCreate()

    await userEvent.click(form.getByLabelText('Follow-Up Required?'))
    await userEvent.click(form.getByRole('button', { name: 'Save Action Taken' }))

    for (const [label, message] of [
      [/^Action Description/, 'Describe what was done.'],
      [/^Result/, 'Enter the result of the action.'],
      [/^Follow-up Note/, 'Say what follow-up is needed.'],
    ] as const) {
      const field = form.getByLabelText(label)
      const problem = form.getByText(message)
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(problem.id)
      // In the same field wrapper, after the control: directly beneath it.
      expect(field.closest('.ttk-field')).toContainElement(problem)
      expect(field.compareDocumentPosition(problem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(sent).toEqual([])
  })

  it('moves focus to the first invalid field', async () => {
    mockApi()
    await openAsStaff()
    const form = await openCreate()

    await userEvent.type(form.getByLabelText(/^Action Description/), 'Reseated the cable.')
    await userEvent.click(form.getByRole('button', { name: 'Save Action Taken' }))

    await waitFor(() => expect(form.getByLabelText(/^Result/)).toHaveFocus())
  })

  it('clears a message as soon as its field is typed in', async () => {
    mockApi()
    await openAsStaff()
    const form = await openCreate()
    await userEvent.click(form.getByRole('button', { name: 'Save Action Taken' }))
    expect(form.getByText('Describe what was done.')).toBeInTheDocument()

    await userEvent.type(form.getByLabelText(/^Action Description/), 'R')

    expect(form.queryByText('Describe what was done.')).not.toBeInTheDocument()
    expect(form.getByText('Enter the result of the action.')).toBeInTheDocument()
  })

  it('rejects a time before the Ticket was created, and one in the future', async () => {
    mockApi()
    await openAsStaff()
    const form = await openCreate()
    await fillRequired()

    fireEvent.change(form.getByLabelText(/^Action Date\/Time/), { target: { value: '2026-08-31T10:00' } })
    await userEvent.click(form.getByRole('button', { name: 'Save Action Taken' }))
    expect(form.getByText('Cannot be earlier than when the Ticket was created.')).toBeInTheDocument()

    const tomorrow = toLocalInput(new Date(Date.now() + 24 * 60 * 60_000))
    fireEvent.change(form.getByLabelText(/^Action Date\/Time/), { target: { value: tomorrow } })
    await userEvent.click(form.getByRole('button', { name: 'Save Action Taken' }))
    expect(form.getByText('Cannot be in the future.')).toBeInTheDocument()
    expect(sent).toEqual([])
  })

  it("shows the server's field messages the same way, and keeps the form", async () => {
    mockApi({
      create: () =>
        Response.json(
          { error: 'Validation failed', fields: { actionAt: 'Cannot be earlier than when the Ticket was created' } },
          { status: 400 },
        ),
    })
    await openAsStaff()
    const form = await openCreate()
    await fillRequired()

    await userEvent.click(form.getByRole('button', { name: 'Save Action Taken' }))

    const problem = await form.findByText('Cannot be earlier than when the Ticket was created')
    const field = form.getByLabelText(/^Action Date\/Time/)
    expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(problem.id)
    await waitFor(() => expect(field).toHaveFocus())
    expect(form.getByLabelText(/^Action Description/)).toHaveValue('Reseated the HDMI cable.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('counts characters under the long fields', async () => {
    mockApi()
    await openAsStaff()
    const form = await openCreate()

    expect(form.getByText('0 / 2000')).toBeInTheDocument()
    expect(form.getByText('0 / 1000')).toBeInTheDocument()
    await userEvent.type(form.getByLabelText(/^Action Description/), 'abc')
    expect(form.getByText('3 / 2000')).toBeInTheDocument()
  })
})

describe('UI-06 a repeated click (BR-30, AC-42)', () => {
  it('sends one request, and holds both buttons until it settles', async () => {
    let release: (response: Response) => void = () => {}
    mockApi({ create: () => new Promise<Response>((resolve) => (release = resolve)) })
    await openAsStaff()
    const form = await openCreate()
    await fillRequired()

    const save = form.getByRole('button', { name: 'Save Action Taken' })
    await userEvent.click(save)

    const busy = await form.findByRole('button', { name: /Saving/ })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(form.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    // A second click, and a second submit by the Enter key in a field.
    await userEvent.click(busy)
    fireEvent.submit(busy.closest('form') as HTMLFormElement)
    expect(sent).toHaveLength(1)

    release(Response.json(action({ id: 99 }), { status: 201 }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sent).toHaveLength(1)
  })
})

describe('UI-07 a failed save keeps the form (BR-20, BR-31, AC-13, AC-43)', () => {
  it.each([
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a server error', () => Response.json({ error: 'Unable to record the Action Taken' }, { status: 500 })],
  ])('after %s the text is still there, and the retry carries the same request key', async (_what, failing) => {
    let fail = true
    mockApi({ create: () => (fail ? failing() : undefined) as Response })
    await openAsStaff()
    const form = await openCreate()
    await fillRequired()
    await userEvent.click(form.getByLabelText('Follow-Up Required?'))
    await userEvent.type(form.getByLabelText(/^Follow-up Note/), 'Order a spare cable.')

    await userEvent.click(form.getByRole('button', { name: 'Save Action Taken' }))

    expect(
      await form.findByText('Unable to save the Action Taken. Your text is still here. Try again.'),
    ).toBeInTheDocument()
    expect(form.getByLabelText(/^Action Description/)).toHaveValue('Reseated the HDMI cable.')
    expect(form.getByLabelText(/^Result/)).toHaveValue('Image is stable.')
    expect(form.getByLabelText('Follow-Up Required?')).toBeChecked()
    expect(form.getByLabelText(/^Follow-up Note/)).toHaveValue('Order a spare cable.')
    // Nothing the server said is repeated to the reader.
    expect(form.queryByText(/Unable to record/)).not.toBeInTheDocument()

    fail = false
    await userEvent.click(form.getByRole('button', { name: 'Save Action Taken' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sent).toHaveLength(2)
    expect(sent[1].body.requestKey).toBe(sent[0].body.requestKey)
    expect(sent[1].body).toEqual(sent[0].body)
  })

  it('keeps the dialog and the typed text when Esc is pressed while a save is in flight', async () => {
    // Cancel is disabled while saving, but Esc is a second way out. If it
    // closed the dialog, a save that then failed would have nowhere to put
    // the text or the error, and reopening would mint a new request key.
    let fail: () => void = () => {}
    let failing = true
    mockApi({
      create: () =>
        failing
          ? new Promise<Response>((_, reject) => {
              fail = () => reject(new TypeError('Failed to fetch'))
            })
          : (undefined as unknown as Response),
    })
    await openAsStaff()
    await openCreate()
    await fillRequired()
    await userEvent.click(dialog().getByRole('button', { name: 'Save Action Taken' }))
    await waitFor(() => expect(sent).toHaveLength(1))

    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fail()
    expect(
      await dialog().findByText('Unable to save the Action Taken. Your text is still here. Try again.'),
    ).toBeInTheDocument()
    expect(dialog().getByLabelText(/^Action Description/)).toHaveValue('Reseated the HDMI cable.')
    expect(dialog().getByLabelText(/^Result/)).toHaveValue('Image is stable.')

    // The retry is still the same form, so it still carries the same key.
    failing = false
    await userEvent.click(dialog().getByRole('button', { name: 'Save Action Taken' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sent[1].body.requestKey).toBe(sent[0].body.requestKey)
  })

  it('still closes on Esc when nothing is being saved', async () => {
    mockApi()
    await openAsStaff()
    await openCreate()
    await fillRequired()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sent).toEqual([])
  })

  it('uses a new request key for a new form', async () => {
    mockApi()
    await openAsStaff()

    await openCreate()
    await fillRequired()
    await userEvent.click(dialog().getByRole('button', { name: 'Save Action Taken' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await openCreate()
    await fillRequired()
    await userEvent.click(dialog().getByRole('button', { name: 'Save Action Taken' }))
    await waitFor(() => expect(sent).toHaveLength(2))

    expect(sent[1].body.requestKey).not.toBe(sent[0].body.requestKey)
  })
})

describe('UI-08 viewing and editing (FR-03, AC-11)', () => {
  const openView = async (name = 'Marcus Reed') => {
    await userEvent.click((await (await loadedTable()).findAllByRole('button', { name: new RegExp(`^View the Action Taken by ${name}`) }))[0])
    return dialog()
  }

  it('shows the view as text with no input in it', async () => {
    mockApi()
    await openAsStaff()

    const view = await openView()

    expect(view.getByRole('heading', { name: 'Action Taken' })).toBeInTheDocument()
    expect(view.queryByRole('textbox')).not.toBeInTheDocument()
    expect(view.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(view.getByText('Follow-up Note').nextElementSibling).toHaveTextContent('None')
    expect(view.getByText('Attachment Notes').nextElementSibling).toHaveTextContent('None')
    expect(view.getByText('Recorded').nextElementSibling).not.toBeEmptyDOMElement()

    await userEvent.click(view.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('fills the form from the saved values, with Performed by as text', async () => {
    mockApi()
    await openAsStaff()
    await openView('Sarah Chen')

    await userEvent.click(dialog().getByRole('button', { name: 'Edit' }))

    const form = dialog()
    expect(form.getByRole('heading', { name: 'Edit Action Taken' })).toBeInTheDocument()
    expect(form.getByLabelText(/^Action Date\/Time/)).toHaveValue(toLocalInput(new Date(NEWER.actionAt)))
    expect(form.getByLabelText(/^Action Description/)).toHaveValue(NEWER.description)
    expect(form.getByLabelText(/^Result/)).toHaveValue(NEWER.result)
    expect(form.getByLabelText('Follow-Up Required?')).toBeChecked()
    expect(form.getByLabelText(/^Follow-up Note/)).toHaveValue('Check again after one week.')
    expect(form.getByLabelText(/^Attachment Notes/)).toHaveValue('Photo of the lamp label: lamp-lx204.jpg')
    // The performer is not Sarah's to change, and is not a control at all.
    expect(form.getByText('Sarah Chen. Cannot be changed.')).toBeInTheDocument()
    expect(form.queryByLabelText(/Performed by/)).not.toBeInTheDocument()
  })

  it('sends the version it was based on, and no request key or performer', async () => {
    mockApi()
    await openAsStaff()
    await openView('Sarah Chen')
    await userEvent.click(dialog().getByRole('button', { name: 'Edit' }))

    const result = dialog().getByLabelText(/^Result/)
    await userEvent.clear(result)
    await userEvent.type(result, 'Hours are at 12.')
    await userEvent.click(dialog().getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ method: 'PATCH', path: '/api/tickets/42/actions/13' })
    expect(sent[0].body).toEqual({
      expectedVersion: 2,
      actionAt: NEWER.actionAt,
      description: NEWER.description,
      result: 'Hours are at 12.',
      followUpRequired: true,
      followUpNote: 'Check again after one week.',
      attachmentNotes: 'Photo of the lamp label: lamp-lx204.jpg',
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await (await loadedTable()).findByText('Hours are at 12.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Action Taken updated.')
  })
})

describe('UI-08 the time of an edited action', () => {
  // The form holds minutes only. An action recorded through the API can carry
  // seconds, and an edit that only touches the text must not move it.
  const WITH_SECONDS = action({ id: 14, actionAt: '2026-09-03T03:15:42.500Z' })

  const openEdit = async () => {
    serverActions = [WITH_SECONDS]
    mockApi()
    await openAsStaff()
    await userEvent.click((await (await loadedTable()).findAllByRole('button', { name: /^View the Action Taken/ }))[0])
    await userEvent.click(dialog().getByRole('button', { name: 'Edit' }))
  }

  it('is sent back exactly as it was when the field is not touched', async () => {
    await openEdit()

    await userEvent.type(dialog().getByLabelText(/^Result/), ' Confirmed.')
    await userEvent.click(dialog().getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body.actionAt).toBe('2026-09-03T03:15:42.500Z')
  })

  it('is the new value, to the minute, when the field is changed', async () => {
    await openEdit()

    fireEvent.change(dialog().getByLabelText(/^Action Date\/Time/), { target: { value: '2026-09-03T12:00' } })
    await userEvent.click(dialog().getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body.actionAt).toBe(new Date('2026-09-03T12:00').toISOString())
  })
})

describe('UI-09 a colleague saved first (BR-17, AC-12)', () => {
  const THEIRS = action({
    description: 'Replaced the lamp and cleaned the filter.',
    result: 'Brighter than before.',
    editedBy: { id: 11, name: 'Marcus Reed' },
    editedAt: '2026-10-01T00:00:00.000Z',
    version: 2,
  })

  /** Answers the first edit as stale and the rest normally. */
  const staleOnce = () => {
    let first = true
    mockApi({
      edit: () => {
        if (!first) return undefined as unknown as Response
        first = false
        return Response.json(
          { error: 'This Action Taken was changed by someone else.', code: 'STALE_ACTION', current: THEIRS },
          { status: 409 },
        )
      },
    })
  }

  const editOlder = async () => {
    await userEvent.click(
      (await (await loadedTable()).findAllByRole('button', { name: /^View the Action Taken by Marcus Reed/ }))[0],
    )
    await userEvent.click(dialog().getByRole('button', { name: 'Edit' }))
    const result = dialog().getByLabelText(/^Result/)
    await userEvent.clear(result)
    await userEvent.type(result, 'My own wording.')
    await userEvent.click(dialog().getByRole('button', { name: 'Save changes' }))
  }

  it('says who changed it and keeps what was typed', async () => {
    staleOnce()
    await openAsStaff()

    await editOlder()

    const alert = await dialog().findByText(
      'Marcus Reed changed this Action Taken while you were editing. Your text is still here.',
    )
    expect(alert.closest('[role="alert"]')).not.toBeNull()
    expect(dialog().getByLabelText(/^Result/)).toHaveValue('My own wording.')
    expect(sent).toHaveLength(1)
    expect(sent[0].body.expectedVersion).toBe(1)
  })

  it('"Save my version" sends the same text again, based on their version', async () => {
    staleOnce()
    await openAsStaff()
    await editOlder()

    await userEvent.click(await dialog().findByRole('button', { name: 'Save my version' }))

    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1].body).toMatchObject({ expectedVersion: 2, result: 'My own wording.' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('"Discard my changes" loads their values, and a later save is based on their version', async () => {
    staleOnce()
    await openAsStaff()
    await editOlder()

    await userEvent.click(await dialog().findByRole('button', { name: 'Discard my changes' }))

    const form = dialog()
    expect(form.getByLabelText(/^Action Description/)).toHaveValue('Replaced the lamp and cleaned the filter.')
    expect(form.getByLabelText(/^Result/)).toHaveValue('Brighter than before.')
    expect(form.queryByText(/changed this Action Taken/)).not.toBeInTheDocument()
    // Nothing was sent by discarding.
    expect(sent).toHaveLength(1)

    await userEvent.click(form.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1].body).toMatchObject({ expectedVersion: 2, result: 'Brighter than before.' })
  })
})

describe('UI-10 a finished Ticket (BR-08, AC-14)', () => {
  it.each([
    ['RESOLVED', 'Resolved'],
    ['CLOSED', 'Closed'],
    ['CANCELLED', 'Cancelled'],
  ] as const)('offers no Add and no Edit on a %s Ticket, and says why', async (status, label) => {
    ticketStatus = status
    mockApi()
    await openAsStaff()

    expect(await section().findByText('2 Actions Taken')).toBeInTheDocument()
    expect(section().getByText(`This Ticket is ${label}. Reopen it to record more work.`)).toBeInTheDocument()
    expect(section().queryByRole('button', { name: 'Add Action Taken' })).not.toBeInTheDocument()

    // Still readable.
    await userEvent.click((await (await loadedTable()).findAllByRole('button', { name: /^View the Action Taken/ }))[0])
    expect(dialog().queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(dialog().getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('does not show that line to a Requester', async () => {
    ticketStatus = 'RESOLVED'
    mockApi()
    await openAsRequester()

    await section().findByText('2 Actions Taken')
    expect(section().queryByText(/Reopen it to record more work/)).not.toBeInTheDocument()
  })

  it("shows the server's reason when the Ticket was finished while the form was open", async () => {
    mockApi({
      create: () =>
        Response.json(
          { error: 'This Ticket is Resolved. Reopen it to record more work.', code: 'TICKET_NOT_ACTIVE' },
          { status: 409 },
        ),
    })
    await openAsStaff()
    await section().findByText('2 Actions Taken')
    const form = await openCreate()
    await fillRequired()
    const ticketReads = reads.ticket

    await userEvent.click(form.getByRole('button', { name: 'Save Action Taken' }))

    expect(await form.findByText('This Ticket is Resolved. Reopen it to record more work.')).toBeInTheDocument()
    expect(form.getByLabelText(/^Action Description/)).toHaveValue('Reseated the HDMI cable.')
    // The Ticket behind the dialog is brought up to date.
    await waitFor(() => expect(reads.ticket).toBe(ticketReads + 1))
  })
})
