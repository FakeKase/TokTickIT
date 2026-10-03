import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'

// UI-17 and the Requester half of AC-18/AC-20/AC-34 (BR-04, BR-24, BR-26).

let signedIn: ReturnType<typeof authUser> | null = authUser()

const TICKET = {
  id: 42,
  ticketNumber: 'TKT-2026-000042',
  requester: { id: 1, name: 'Peter Parker' },
  category: { id: 10, name: 'Hardware' },
  relatedSystem: { id: 20, name: 'Corporate Laptop' },
  summary: 'Laptop will not start',
  description: 'Nothing happens when the power button is pressed.',
  requestedPriority: 'MEDIUM',
  currentStatus: 'NEW',
  requesterResolvedAt: null as string | null,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  attachments: [],
}

const comment = (id: number, body: string, overrides: Record<string, unknown> = {}) => ({
  id,
  ticketId: 42,
  visibility: 'PUBLIC',
  body,
  author: { id: 9, name: 'Sarah Chen', role: 'IT_STAFF' },
  createdAt: '2026-09-02T10:00:00.000Z',
  ...overrides,
})

interface Handlers {
  ticket?: Record<string, unknown>
  comments?: () => Promise<Response>
  post?: () => Promise<Response>
  resolve?: () => Promise<Response>
}

/** Records what the screen sent, so a test can assert the request and not just
 *  the pixels it produced. */
let posted: unknown[] = []
let resolveCalls = 0

function mockApi({ ticket = TICKET, comments, post, resolve }: Handlers = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(((
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input)
    const auth = authRoutes(signedIn)(url)
    if (auth) return auth

    if (url.includes('/requester-resolved')) {
      resolveCalls += 1
      return (
        resolve?.() ??
        Promise.resolve(
          Response.json({
            id: 42,
            currentStatus: 'NEW',
            requesterResolvedAt: '2026-09-03T08:00:00.000Z',
          }),
        )
      )
    }
    if (url.includes('/comments')) {
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)))
        return (
          post?.() ??
          Promise.resolve(
            Response.json(comment(99, 'Thanks, that worked.', {
              author: { id: 1, name: 'Peter Parker', role: 'REQUESTER' },
            }), { status: 201 }),
          )
        )
      }
      return comments?.() ?? Promise.resolve(Response.json([]))
    }
    if (/\/api\/tickets\/\d+$/.test(url)) return Promise.resolve(Response.json(ticket))
    return Promise.resolve(Response.json([]))
  }) as typeof fetch)
}

const openDetail = async () => {
  window.history.pushState({}, '', '/tickets/42')
  await renderApp()
  await screen.findByText('TKT-2026-000042')
}

beforeEach(() => {
  vi.restoreAllMocks()
  signedIn = authUser()
  posted = []
  resolveCalls = 0
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('UI-17 the public thread (AC-18, BR-26)', () => {
  it('renders each entry with its author, role and time', async () => {
    mockApi({
      comments: () =>
        Promise.resolve(
          Response.json([
            comment(1, 'Could you try restarting it?'),
            comment(2, 'Tried that, no change.', {
              author: { id: 1, name: 'Peter Parker', role: 'REQUESTER' },
            }),
          ]),
        ),
    })

    await openDetail()

    const thread = await screen.findByRole('list')
    const entries = within(thread).getAllByRole('listitem')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent('Sarah Chen')
    expect(entries[0]).toHaveTextContent('IT Staff')
    expect(entries[0]).toHaveTextContent('Could you try restarting it?')
    expect(entries[1]).toHaveTextContent('Peter Parker')
    expect(entries[1]).toHaveTextContent('Requester')
  })

  it('says who can read it before anybody types', async () => {
    mockApi()
    await openDetail()

    expect(screen.getByText(/visible to you and to it staff/i)).toBeInTheDocument()
  })

  it('posts a comment and shows it without a reload', async () => {
    mockApi()
    await openDetail()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Add a comment/i), '  Thanks, that worked.  ')
    await user.click(screen.getByRole('button', { name: /Post comment/i }))

    expect(await screen.findByText('Thanks, that worked.')).toBeInTheDocument()
    // Trimmed before sending, so the server stores what a reader sees.
    expect(posted).toEqual([{ body: 'Thanks, that worked.' }])
    // The box is cleared only on success.
    expect(screen.getByLabelText(/Add a comment/i)).toHaveValue('')
  })

  it('rejects an empty or whitespace-only comment without calling the API', async () => {
    mockApi()
    await openDetail()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Post comment/i }))
    expect(await screen.findByText('Enter a comment')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Add a comment/i), '    ')
    await user.click(screen.getByRole('button', { name: /Post comment/i }))

    expect(posted).toEqual([])
  })

  it('keeps what was typed when posting fails', async () => {
    mockApi({
      post: () => Promise.resolve(Response.json({ error: 'nope' }, { status: 500 })),
    })
    await openDetail()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Add a comment/i), 'Worth not losing.')
    await user.click(screen.getByRole('button', { name: /Post comment/i }))

    expect(await screen.findByText(/unable to post your comment/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Add a comment/i)).toHaveValue('Worth not losing.')
  })

  it('offers no way to edit or delete an entry (BR-26)', async () => {
    mockApi({ comments: () => Promise.resolve(Response.json([comment(1, 'Posted once.')])) })
    await openDetail()

    const thread = await screen.findByRole('list')
    expect(within(thread).queryByRole('button', { name: /edit|delete|remove/i })).toBeNull()
  })

  it('AC-34: shows nothing about Internal Notes', async () => {
    // The server never sends one, so the screen has nothing to hide — this
    // guards against a future change that starts asking for them.
    mockApi({ comments: () => Promise.resolve(Response.json([comment(1, 'Public only.')])) })
    await openDetail()

    expect(screen.queryByText(/internal/i)).not.toBeInTheDocument()
  })

  it('keeps the Ticket on screen when only the thread fails', async () => {
    mockApi({
      comments: () => Promise.resolve(Response.json({ error: 'nope' }, { status: 500 })),
    })
    await openDetail()

    // The Ticket loaded, so it stays: the failure belongs to the thread.
    expect(screen.getByText('TKT-2026-000042')).toBeInTheDocument()
    expect(await screen.findByText(/comments could not be loaded/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
  })
})

describe('AC-20 problem appears resolved (BR-05, BR-24)', () => {
  it('confirms first, then records the signal and leaves the status alone', async () => {
    mockApi()
    await openDetail()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Problem appears resolved/i }))

    // The confirmation says plainly that this does not close the Ticket.
    expect(screen.getByText(/does not close it now/i)).toBeInTheDocument()
    expect(resolveCalls).toBe(0)

    await user.click(screen.getByRole('button', { name: /Yes, it appears resolved/i }))

    expect(resolveCalls).toBe(1)
    expect(await screen.findByText(/you reported that this problem appears resolved/i)).toBeInTheDocument()
    // Still New: the Requester signalled, they did not resolve it (BR-05).
    expect(screen.getByText('New')).toBeInTheDocument()
  })

  it('sends nothing if the confirmation is cancelled', async () => {
    mockApi()
    await openDetail()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Problem appears resolved/i }))
    await user.click(screen.getByRole('button', { name: /^Cancel$/i }))

    expect(resolveCalls).toBe(0)
    expect(screen.getByRole('button', { name: /Problem appears resolved/i })).toBeInTheDocument()
  })

  it('shows the signal on a later visit, not just the one that sent it', async () => {
    mockApi({ ticket: { ...TICKET, requesterResolvedAt: '2026-09-03T08:00:00.000Z' } })
    await openDetail()

    expect(screen.getByText(/you reported that this problem appears resolved/i)).toBeInTheDocument()
    // Still open, so the Ticket is still waiting on IT Staff.
    expect(screen.getByText(/will confirm and close the Ticket/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Problem appears resolved/i })).toBeNull()
  })

  it('stops promising a confirmation once the Ticket is settled', async () => {
    mockApi({
      ticket: {
        ...TICKET,
        currentStatus: 'CLOSED',
        requesterResolvedAt: '2026-09-03T08:00:00.000Z',
      },
    })
    await openDetail()

    // The signal still happened and is still worth showing. What has stopped
    // being true is the sentence about what happens next.
    expect(screen.getByText(/you reported that this problem appears resolved/i)).toBeInTheDocument()
    expect(screen.queryByText(/will confirm and close/i)).toBeNull()
  })

  it('reloads rather than retrying when the signal is already recorded', async () => {
    // The mock reads this object on every Ticket GET, so mutating it is a
    // second tab, or IT Staff, changing the Ticket between the two requests.
    const ticket = { ...TICKET }
    mockApi({
      ticket,
      resolve: () => {
        ticket.requesterResolvedAt = '2026-09-03T08:00:00.000Z'
        return Promise.resolve(
          Response.json({ error: 'This Ticket can no longer be marked as resolved' }, { status: 409 }),
        )
      },
    })
    await openDetail()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Problem appears resolved/i }))
    await user.click(screen.getByRole('button', { name: /Yes, it appears resolved/i }))

    // A 409 is this screen being out of date, not a failure to report. The
    // person gets the state they were asking for, not a Retry that cannot work.
    expect(await screen.findByText(/you reported that this problem appears resolved/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(resolveCalls).toBe(1)
  })

  it('takes the control away when IT Staff settled the Ticket first', async () => {
    const ticket = { ...TICKET }
    mockApi({
      ticket,
      resolve: () => {
        ticket.currentStatus = 'RESOLVED'
        return Promise.resolve(
          Response.json({ error: 'This Ticket can no longer be marked as resolved' }, { status: 409 }),
        )
      },
    })
    await openDetail()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Problem appears resolved/i }))
    await user.click(screen.getByRole('button', { name: /Yes, it appears resolved/i }))

    await waitFor(() => expect(screen.getByText('Resolved')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Problem appears resolved/i })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers nothing on a Ticket that is already finished', async () => {
    for (const currentStatus of ['RESOLVED', 'CLOSED', 'CANCELLED']) {
      vi.restoreAllMocks()
      mockApi({ ticket: { ...TICKET, currentStatus } })
      await openDetail()

      expect(
        screen.queryByRole('button', { name: /Problem appears resolved/i }),
        currentStatus,
      ).toBeNull()

      const { cleanup } = await import('@testing-library/react')
      cleanup()
    }
  })

  it('reports a failure without claiming the signal was recorded', async () => {
    mockApi({
      resolve: () => Promise.resolve(Response.json({ error: 'nope' }, { status: 500 })),
    })
    await openDetail()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Problem appears resolved/i }))
    await user.click(screen.getByRole('button', { name: /Yes, it appears resolved/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/unable to record that/i)
    await waitFor(() =>
      expect(screen.queryByText(/you reported that this problem/i)).toBeNull(),
    )
  })
})
