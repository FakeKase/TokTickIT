import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../helpers/renderApp'
import { authRoutes, authUser } from '../helpers/auth'

// UI-12 (AC-17): the Ticket Detail header renders read-only, with none of the
// controls handout §4.2 puts out of scope.

const REQUESTER = { id: 1, name: 'Peter Parker', email: 'peter.parker@toktickit.test' }

const TICKET = {
  id: 42,
  ticketNumber: 'TKT-2026-000042',
  requester: { id: 1, name: 'Peter Parker' },
  category: { id: 2, name: 'Hardware' },
  relatedSystem: { id: 3, name: 'Corporate Laptop' },
  summary: 'Projector will not power on',
  description: 'The lecture theatre projector shows no lights at all.\nSecond line.',
  requestedPriority: 'HIGH',
  currentStatus: 'NEW',
  createdAt: '2026-09-01T09:14:00.000Z',
  updatedAt: '2026-09-02T11:00:00.000Z',
  attachments: [],
}

function mockApi(detail: () => Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
    const url = String(input)
    const auth = authRoutes(signedIn)(url)
    if (auth) return auth
    // Lab 3 added the thread; without this it falls through to the list
    // branch below and the detail screen gets a paginated object where it
    // expects an array.
    if (/\/api\/tickets\/\d+\/comments$/.test(url)) return Promise.resolve(Response.json([]))
    if (/\/api\/tickets\/\d+$/.test(url)) return detail()
    if (url.includes('/api/tickets')) {
      return Promise.resolve(
        Response.json({
          data: [],
          pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 },
          filtered: false,
        }),
      )
    }
    return Promise.resolve(Response.json([]))
  }) as typeof fetch)
}

function renderDetail(path = '/tickets/42') {
  window.history.pushState({}, '', path)
  return renderApp()
}

let signedIn: ReturnType<typeof authUser> | null = authUser()

describe('Requester Ticket Detail', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    signedIn = authUser({ id: REQUESTER.id, name: REQUESTER.name, email: REQUESTER.email })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('UI-12 (AC-17): renders every header field with no editable control', async () => {
    mockApi(() => Promise.resolve(Response.json(TICKET)))

    await renderDetail()

    expect(await screen.findByText('TKT-2026-000042')).toBeInTheDocument()
    expect(screen.getByText('Projector will not power on')).toBeInTheDocument()
    expect(screen.getByText('Corporate Laptop')).toBeInTheDocument()
    expect(screen.getByText('Hardware')).toBeInTheDocument()

    // AC-17 governs the header card's fields. Scoped to that card rather than
    // the document, because the Attachments panel below it is an acting area
    // and legitimately owns a file input.
    const header = document.querySelector('.ttk-detail__card')!
    expect(header).toBeTruthy()
    // Read-only means no form control at all here, not a disabled one.
    expect(header.querySelectorAll('input, select, textarea')).toHaveLength(0)
    expect(within(header as HTMLElement).queryAllByRole('textbox')).toHaveLength(0)
    expect(within(header as HTMLElement).queryAllByRole('combobox')).toHaveLength(0)
  })

  it('shows both badges with their text label', async () => {
    mockApi(() => Promise.resolve(Response.json(TICKET)))

    await renderDetail()

    // ui-spec.md §7: colour is never the only signal.
    expect(await screen.findByText('High')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
  })

  it('preserves the line breaks the Requester typed', async () => {
    mockApi(() => Promise.resolve(Response.json(TICKET)))

    await renderDetail()

    const description = await screen.findByText(/lecture theatre projector/)
    expect(description).toHaveClass('ttk-detail__description')
    expect(description.textContent).toContain('Second line.')
  })

  // Lab 2 asserted this screen had no comments at all, which handout §4.2 put
  // out of scope for that sprint. Lab 3 Issue #42 adds the public thread and
  // the "appears resolved" signal, so what is left to assert is the boundary
  // that still holds: no internal notes, no Actions Taken, and no control that
  // changes the Ticket's status (BR-05).
  it('handout §4.6: no Internal Notes, no Actions Taken, no status control', async () => {
    mockApi(() => Promise.resolve(Response.json(TICKET)))

    await renderDetail()
    await screen.findByText('TKT-2026-000042')

    for (const forbidden of [/internal note/i, /actions taken/i]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument()
    }

    // Current Status is displayed, and nothing offers to change it. The
    // resolved signal is not a status control: it is excluded by name below so
    // this assertion cannot pass by accident if one is ever added.
    const statusControl = screen
      .queryAllByRole('button')
      .filter((button) => /change status|mark .*(resolved|closed)|close ticket/i.test(button.textContent ?? ''))
    expect(statusControl).toHaveLength(0)
  })

  it('AC-03/BR-08: a 404 is reported without claiming the Ticket exists', async () => {
    mockApi(() =>
      Promise.resolve(Response.json({ error: 'Ticket not found' }, { status: 404 })),
    )

    await renderDetail()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Ticket not found/i)
    // The server deliberately cannot distinguish these two, so neither can the
    // copy — saying "you do not have access" would confirm it exists.
    expect(alert).toHaveTextContent(/does not exist, or it belongs to a different Requester/i)
  })

  it('BR-08: keys off the 404 status, not the wording of the message', async () => {
    // The previous version regex-matched "not found" in the message, so this
    // reworded-but-still-404 response fell into the generic failure branch and
    // offered a Retry that can never succeed. Nothing tied the client's string
    // to the server's, so the old test only checked the client against itself.
    mockApi(() =>
      Promise.resolve(
        Response.json({ error: 'No such ticket for this requester' }, { status: 404 }),
      ),
    )

    await renderDetail()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Ticket not found/i)
    expect(screen.queryByRole('button', { name: /Retry/i })).not.toBeInTheDocument()
  })

  it('treats a 500 that happens to say "not found" as a retryable failure', async () => {
    // The mirror image: matching on wording also mislabelled genuine server
    // errors whose text merely contained the phrase.
    mockApi(() =>
      Promise.resolve(
        Response.json({ error: 'Upstream not found' }, { status: 500 }),
      ),
    )

    await renderDetail()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Unable to load the Ticket/i)
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
  })

  it('offers a retry for a genuine failure, but not for a 404', async () => {
    mockApi(() => Promise.reject(new TypeError('Failed to fetch')))

    await renderDetail()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Unable to load the Ticket/i)
    expect(alert).not.toHaveTextContent(/Failed to fetch/)
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
  })

  it('treats a non-numeric id as not found without calling the API', async () => {
    const fetchSpy = mockApi(() => Promise.resolve(Response.json(TICKET)))

    await renderDetail('/tickets/not-a-number')

    expect(await screen.findByText(/Ticket not found/i)).toBeInTheDocument()
    expect(
      fetchSpy.mock.calls.filter(([url]) => /\/api\/tickets\/\w+\?/.test(String(url))),
    ).toHaveLength(0)
  })

  it('links back to My Tickets', async () => {
    const user = userEvent.setup()
    mockApi(() => Promise.resolve(Response.json(TICKET)))

    await renderDetail()
    await screen.findByText('TKT-2026-000042')

    await user.click(screen.getByRole('link', { name: /Back to My Tickets/i }))

    expect(window.location.pathname).toBe('/tickets')
  })

  it('AC-02: sends a visitor with no session to Login', async () => {
    // Lab 2 sent them to the Requester selector. There is no selector now:
    // identity comes from a session the server issued, so the only "not
    // selected" state left is "not signed in".
    signedIn = null
    mockApi(() => Promise.resolve(Response.json(TICKET)))

    await renderDetail()

    expect(await screen.findByRole('heading', { name: /Sign in/i })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
  })
})
