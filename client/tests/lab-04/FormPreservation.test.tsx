import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuthenticatedUser } from '../../src/api'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'

// UI-29 (Lab 4 BR-31, AC-43; handout §8.5).
//
// The forms built in Labs 2 and 3, audited for the two things the handout asks
// of every form: a submission that fails keeps what was typed, and pressing
// the button again while one is on its way does not send a second.
//
// Each case runs the same three steps against a server that fails the first
// write and accepts the second:
//
//   1. submit twice in a row while the first request is still open
//   2. let it fail, and check the message, the values and the request count
//   3. submit again, unchanged, and check it goes through with the same body
//
// The Action Taken dialog is not here: UI-08 to UI-13 already hold it to both.

let signedIn: AuthenticatedUser

interface Write {
  method: string
  path: string
  body: Record<string, unknown>
}

/** Every write the screen made, in order. */
let writes: Write[] = []
/** Lets the write that is being held open go, as a failure. */
let failHeld: (how: 'network' | 'server') => void = () => {}

const TICKET = {
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
  transitions: [{ to: 'WAITING_FOR_REQUESTER', requiresOwner: false, blockedReason: null }],
  ownerRequired: false,
  version: 1,
  resolvedAt: null,
}

/**
 * The first write is held open until the test lets it fail. Every later one
 * succeeds with whatever `accept` returns for it.
 */
function mockApi(accept: (write: Write) => Response) {
  writes = []
  let held = false

  vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const auth = authRoutes(signedIn)(url)
    if (auth) return auth

    const method = init?.method ?? 'GET'
    const path = new URL(url, 'http://localhost').pathname

    if (method !== 'GET') {
      const write = { method, path, body: init?.body ? JSON.parse(String(init.body)) : {} }
      writes.push(write)
      if (!held) {
        held = true
        return new Promise<Response>((resolve, reject) => {
          failHeld = (how) =>
            how === 'network'
              ? reject(new TypeError('Failed to fetch'))
              : resolve(Response.json({ error: 'Internal server error' }, { status: 500 }))
        })
      }
      return Promise.resolve(accept(write))
    }

    if (path === '/api/categories') {
      return Promise.resolve(Response.json([{ id: 10, name: 'Hardware', description: 'Devices' }]))
    }
    if (path === '/api/related-systems') {
      return Promise.resolve(Response.json([{ id: 20, name: 'Corporate Laptop' }]))
    }
    if (path === '/api/users') {
      return Promise.resolve(
        Response.json([
          {
            ...authUser({ id: 2, name: 'Ada Admin', email: 'ada.admin@toktickit.test', role: 'ADMINISTRATOR' }),
            isLastActiveAdministrator: true,
          },
        ]),
      )
    }
    if (/^\/api\/(staff\/)?tickets\/42$/.test(path)) return Promise.resolve(Response.json(TICKET))
    return Promise.resolve(Response.json([]))
  }) as typeof fetch)
}

async function open(path: string, user: Partial<AuthenticatedUser>) {
  signedIn = authUser(user)
  window.history.pushState({}, '', path)
  await renderApp()
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

const posted = (body: string, visibility: 'PUBLIC' | 'INTERNAL') =>
  Response.json(
    {
      id: 99,
      ticketId: 42,
      visibility,
      body,
      author: { id: signedIn.id, name: signedIn.name, role: signedIn.role },
      createdAt: '2026-09-03T10:00:00.000Z',
    },
    { status: 201 },
  )

describe('UI-29 earlier forms keep their data after a failed submission (BR-31, AC-43)', () => {
  it.each([
    ['network', 'the request never arrives'],
    ['server', 'the server answers 500'],
  ] as const)("the Requester's comment composer, when %s: %s", async (how, _what) => {
    mockApi((write) => posted(String(write.body.body), 'PUBLIC'))
    await open('/tickets/42', { id: 1, role: 'REQUESTER' })
    const user = userEvent.setup()
    const box = await screen.findByLabelText('Add a comment')

    await user.type(box, 'It is the charger, not the laptop.')
    await user.click(screen.getByRole('button', { name: 'Post comment' }))
    // Busy, so a second press goes nowhere.
    expect(screen.getByRole('button', { name: /Posting…/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Posting…/ }))
    expect(writes).toHaveLength(1)

    failHeld(how)
    expect(await screen.findByText('Unable to post your comment right now. Please try again.')).toBeInTheDocument()
    expect(box).toHaveValue('It is the charger, not the laptop.')
    expect(writes).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Post comment' }))
    await waitFor(() => expect(box).toHaveValue(''))
    expect(writes).toHaveLength(2)
    expect(writes[1].body).toEqual(writes[0].body)
    expect(screen.getByText('It is the charger, not the laptop.')).toBeInTheDocument()
    expect(screen.queryByText(/Unable to post/)).not.toBeInTheDocument()
  })

  it('the staff comment composer and the note composer, each on its own', async () => {
    mockApi((write) => posted(String(write.body.body), write.body.visibility as 'PUBLIC' | 'INTERNAL'))
    await open('/staff/tickets/42', { id: 9, name: 'Sarah Chen', role: 'IT_STAFF' })
    const user = userEvent.setup()
    const comment = await screen.findByLabelText('Add a public comment')
    const note = screen.getByLabelText('Add an internal note')

    // Something half-written in the other composer, which is not being sent.
    await user.type(comment, 'Could you try another socket?')
    await user.type(note, 'Third dead charger from this batch.')
    await user.click(screen.getByRole('button', { name: 'Add internal note' }))
    expect(writes).toHaveLength(1)

    failHeld('server')
    expect(await screen.findByText('Unable to post your note right now. Please try again.')).toBeInTheDocument()
    expect(note).toHaveValue('Third dead charger from this batch.')
    // The failure of one composer did not touch the other.
    expect(comment).toHaveValue('Could you try another socket?')
    expect(screen.queryByText(/Unable to post your comment/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add internal note' }))
    await waitFor(() => expect(note).toHaveValue(''))
    expect(writes.map((write) => write.body)).toEqual([
      { body: 'Third dead charger from this batch.', visibility: 'INTERNAL' },
      { body: 'Third dead charger from this batch.', visibility: 'INTERNAL' },
    ])
    expect(comment).toHaveValue('Could you try another socket?')

    await user.click(screen.getByRole('button', { name: 'Post comment' }))
    await waitFor(() => expect(comment).toHaveValue(''))
    expect(writes[2].body).toEqual({ body: 'Could you try another socket?', visibility: 'PUBLIC' })
  })

  it('Create Ticket', async () => {
    mockApi(() => Response.json({ id: 500, ticketNumber: 'TKT-2026-000500' }, { status: 201 }))
    await open('/tickets/new', { id: 1, role: 'REQUESTER' })
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText(/^Category/), '10')
    await user.selectOptions(screen.getByLabelText(/^Related System/), '20')
    await user.selectOptions(screen.getByLabelText(/^Requested Priority/), 'HIGH')
    await user.type(screen.getByLabelText(/^Summary/), 'Laptop battery drains quickly')
    await user.type(screen.getByLabelText(/^Description/), 'Full to empty in about an hour.')

    await user.click(screen.getByRole('button', { name: 'Create Ticket' }))
    expect(screen.getByRole('button', { name: /Creating Ticket…/ })).toBeDisabled()
    // Every field is locked while the request is out, so nothing can be
    // changed under it.
    expect(screen.getByLabelText(/^Summary/)).toBeDisabled()
    expect(writes).toHaveLength(1)

    failHeld('network')
    expect(
      await screen.findByText('Unable to reach the TokTickIT API. Your entries have been kept.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/^Category/)).toHaveValue('10')
    expect(screen.getByLabelText(/^Related System/)).toHaveValue('20')
    expect(screen.getByLabelText(/^Requested Priority/)).toHaveValue('HIGH')
    expect(screen.getByLabelText(/^Summary/)).toHaveValue('Laptop battery drains quickly')
    expect(screen.getByLabelText(/^Description/)).toHaveValue('Full to empty in about an hour.')
    expect(screen.getByLabelText(/^Summary/)).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Create Ticket' }))
    expect(await screen.findByText('TKT-2026-000500')).toBeInTheDocument()
    expect(writes).toHaveLength(2)
    expect(writes[1].body).toEqual(writes[0].body)
    expect(writes[1].body).toEqual({
      categoryId: 10,
      relatedSystemId: 20,
      requestedPriority: 'HIGH',
      summary: 'Laptop battery drains quickly',
      description: 'Full to empty in about an hour.',
    })
  })

  it('the user dialog', async () => {
    mockApi((write) => Response.json({ id: 100, ...write.body }, { status: 201 }))
    await open('/admin/users', { id: 2, name: 'Ada Admin', email: 'ada.admin@toktickit.test', role: 'ADMINISTRATOR' })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'New user' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.type(dialog.getByLabelText(/^Name/), 'Nina Newcomer')
    await user.type(dialog.getByLabelText(/^Email/), 'nina.newcomer@toktickit.test')
    await user.click(dialog.getByRole('radio', { name: 'IT Staff' }))
    await user.type(dialog.getByLabelText(/^Initial password/), 'Initial123!')

    await user.click(dialog.getByRole('button', { name: 'Create user' }))
    expect(dialog.getByRole('button', { name: /Saving…/ })).toBeDisabled()
    // Closing would throw the form away with the request still out.
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(writes).toHaveLength(1)

    failHeld('server')
    expect(await dialog.findByText('The user could not be saved. Please try again.')).toBeInTheDocument()
    expect(dialog.getByLabelText(/^Name/)).toHaveValue('Nina Newcomer')
    expect(dialog.getByLabelText(/^Email/)).toHaveValue('nina.newcomer@toktickit.test')
    expect(dialog.getByRole('radio', { name: 'IT Staff' })).toBeChecked()
    expect(dialog.getByLabelText(/^Initial password/)).toHaveValue('Initial123!')

    await user.click(dialog.getByRole('button', { name: 'Create user' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(writes).toHaveLength(2)
    expect(writes[1]).toEqual(writes[0])
    expect(writes[1].body).toMatchObject({
      name: 'Nina Newcomer',
      email: 'nina.newcomer@toktickit.test',
      role: 'IT_STAFF',
      initialPassword: 'Initial123!',
    })
  })
})
