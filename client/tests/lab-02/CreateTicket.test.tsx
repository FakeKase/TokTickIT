import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../src/App'
import { REQUESTER_STORAGE_KEY } from '../../src/requester/requesterContext'

// UI-05, UI-06, UI-07, UI-08, UI-09, UI-14: the Create Ticket screen
// (ui-spec.md §6.2). Rendered through <App /> at /tickets/new so the guard,
// the shell and the screen are exercised together.

const REQUESTER = { id: 1, name: 'Peter Parker', email: 'peter.parker@toktickit.test' }
const CATEGORIES = [
  { id: 10, name: 'Hardware', description: 'Devices' },
  { id: 11, name: 'Software', description: 'Applications' },
]
const RELATED_SYSTEMS = [
  { id: 20, name: 'Corporate Laptop' },
  { id: 21, name: 'Campus Wi-Fi' },
]
const TICKET = {
  id: 500,
  ticketNumber: 'TKT-2026-000500',
  requesterId: 1,
  categoryId: 10,
  relatedSystemId: 20,
  summary: 'Laptop battery drains quickly',
  description: 'The battery drops from full to empty in about an hour.',
  requestedPriority: 'MEDIUM',
  currentStatus: 'NEW',
  createdAt: '2026-09-05T09:00:00.000Z',
}

/** Routes fetch by URL so tests can vary one endpoint without stubbing call order. */
function mockApi(overrides: { createTicket?: () => Promise<Response> } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/categories')) return Promise.resolve(Response.json(CATEGORIES))
    if (url.includes('/api/related-systems')) {
      return Promise.resolve(Response.json(RELATED_SYSTEMS))
    }
    if (url.includes('/attachments')) {
      return Promise.resolve(Response.json({ id: 1 }, { status: 201 }))
    }
    if (url.includes('/api/tickets')) {
      return overrides.createTicket
        ? overrides.createTicket()
        : Promise.resolve(Response.json(TICKET, { status: 201 }))
    }
    return Promise.resolve(Response.json([]))
  }) as typeof fetch)
}

async function renderForm() {
  window.history.pushState({}, '', '/tickets/new')
  render(<App />)
  // Wait for the reference data to land so the form is on screen.
  await screen.findByLabelText(/^Category/)
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(/^Category/), '10')
  await user.selectOptions(screen.getByLabelText(/^Related System/), '20')
  await user.selectOptions(screen.getByLabelText(/^Requested Priority/), 'MEDIUM')
  await user.type(screen.getByLabelText(/^Summary/), 'Laptop battery drains quickly')
  await user.type(
    screen.getByLabelText(/^Description/),
    'The battery drops from full to empty in about an hour.',
  )
}

function submit() {
  return screen.getByRole('button', { name: /Create Ticket/i })
}

function pngFile(name = 'shot.png', bytes = 1024) {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' })
}

describe('Create Ticket', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, JSON.stringify(REQUESTER))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('shows the Requester from context as a read-only field, not a dropdown', async () => {
    mockApi()
    await renderForm()

    const field = screen.getByLabelText(/^Requester/) as HTMLInputElement
    expect(field.value).toBe('Peter Parker')
    expect(field.readOnly).toBe(true)
    // Read-only and disabled are distinct states (ui-spec.md §3); a disabled
    // field would drop out of the tab order and read as inactive.
    expect(field.disabled).toBe(false)
    expect(field.tagName).toBe('INPUT')
  })

  it('UI-05 (AC-04, AC-05): blocks submit with per-field messages and fires no request', async () => {
    const fetchSpy = mockApi()
    const user = userEvent.setup()
    await renderForm()

    const callsAfterLoad = fetchSpy.mock.calls.length
    await user.click(submit())

    expect(await screen.findByText('Category is required.')).toBeInTheDocument()
    expect(screen.getByText('Related System is required.')).toBeInTheDocument()
    expect(screen.getByText('Requested Priority is required.')).toBeInTheDocument()
    expect(screen.getByText('Summary is required.')).toBeInTheDocument()
    expect(screen.getByText('Description is required.')).toBeInTheDocument()

    // AC-04 is explicit that no API call is made.
    expect(fetchSpy.mock.calls.length).toBe(callsAfterLoad)
  })

  it('UI-05: enforces the Summary and Description length bounds', async () => {
    mockApi()
    const user = userEvent.setup()
    await renderForm()

    await user.type(screen.getByLabelText(/^Summary/), 'abcd')
    await user.type(screen.getByLabelText(/^Description/), 'too short')
    await user.click(submit())

    expect(await screen.findByText(/Summary must be at least 5/)).toBeInTheDocument()
    expect(screen.getByText(/Description must be at least 10/)).toBeInTheDocument()
  })

  it('UI-05: measures length after trimming, so padding cannot pass', async () => {
    mockApi()
    const user = userEvent.setup()
    await renderForm()

    await user.type(screen.getByLabelText(/^Summary/), '   ab   ')
    await user.click(submit())

    expect(await screen.findByText(/Summary must be at least 5/)).toBeInTheDocument()
  })

  it('UI-06 (AC-06, BR-17): shows a busy Submit and sends only one request', async () => {
    let release: (value: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    const fetchSpy = mockApi({ createTicket: () => pending })
    const user = userEvent.setup()
    await renderForm()
    await fillValid(user)

    await user.click(submit())

    const busy = await screen.findByRole('button', { name: /Creating Ticket…/i })
    expect(busy).toBeDisabled()

    // BR-17: repeat clicks while in flight must not create a second Ticket.
    await user.click(busy).catch(() => {})
    const creates = fetchSpy.mock.calls.filter(
      ([url, init]) => String(url).endsWith('/api/tickets') && (init as RequestInit)?.method === 'POST',
    )
    expect(creates).toHaveLength(1)

    release(Response.json(TICKET, { status: 201 }))
    await screen.findByText('TKT-2026-000500')
  })

  it('UI-07 (AC-07, BR-18): keeps entered values and shows a safe banner on failure', async () => {
    mockApi({ createTicket: () => Promise.reject(new TypeError('Failed to fetch')) })
    const user = userEvent.setup()
    await renderForm()
    await fillValid(user)

    await user.click(submit())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Unable to reach the TokTickIT API/i)
    expect(alert).not.toHaveTextContent(/Failed to fetch/)

    // Every entered value survives.
    expect((screen.getByLabelText(/^Summary/) as HTMLInputElement).value).toBe(
      'Laptop battery drains quickly',
    )
    expect((screen.getByLabelText(/^Description/) as HTMLTextAreaElement).value).toContain(
      'The battery drops',
    )
    expect((screen.getByLabelText(/^Category/) as HTMLSelectElement).value).toBe('10')
    expect((screen.getByLabelText(/^Requested Priority/) as HTMLSelectElement).value).toBe(
      'MEDIUM',
    )
  })

  it('UI-07 (BR-16): puts a server field message under its own control', async () => {
    mockApi({
      createTicket: () =>
        Promise.resolve(
          Response.json(
            { error: 'Validation failed', fields: { summary: 'Summary is taken by the server rule.' } },
            { status: 400 },
          ),
        ),
    })
    const user = userEvent.setup()
    await renderForm()
    await fillValid(user)

    await user.click(submit())

    expect(await screen.findByText('Summary is taken by the server rule.')).toBeInTheDocument()
  })

  it('UI-08 (AC-09): rejects an unsupported file inline and does not queue it', async () => {
    mockApi()
    await renderForm()

    // fireEvent, not userEvent.upload: userEvent honours the input's `accept`
    // and would drop the .exe before the component ever saw it. A real user
    // can still get one through — the picker's "All files" option, or
    // drag-and-drop, neither of which `accept` constrains — so the component's
    // own check is what has to reject it.
    fireEvent.change(screen.getByLabelText(/Add files/i), {
      target: { files: [new File(['MZ'], 'payload.exe', { type: 'application/x-msdownload' })] },
    })

    expect(await screen.findByText(/payload\.exe is not a permitted type/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove payload\.exe/ })).not.toBeInTheDocument()
  })

  it('UI-08: rejects a disallowed file renamed to a permitted extension', async () => {
    mockApi()
    await renderForm()

    fireEvent.change(screen.getByLabelText(/Add files/i), {
      target: { files: [new File(['MZ'], 'payload.png', { type: 'application/x-msdownload' })] },
    })

    expect(await screen.findByText(/payload\.png is not a permitted type/)).toBeInTheDocument()
  })

  it('UI-08 (AC-08): rejects a file over 5 MB inline', async () => {
    mockApi()
    const user = userEvent.setup()
    await renderForm()

    await user.upload(
      screen.getByLabelText(/Add files/i),
      pngFile('huge.png', 6 * 1024 * 1024),
    )

    expect(await screen.findByText(/huge\.png is larger than 5 MB/)).toBeInTheDocument()
  })

  it('UI-08 (AC-10): stops queueing past the five-attachment cap', async () => {
    mockApi()
    const user = userEvent.setup()
    await renderForm()

    const input = screen.getByLabelText(/Add files/i)
    await user.upload(
      input,
      Array.from({ length: 6 }, (_, i) => pngFile(`file-${i}.png`)),
    )

    expect(await screen.findByText(/at most 5 attachments/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Remove file-/ })).toHaveLength(5)
  })

  it('queues a valid file with its size and allows removing it', async () => {
    mockApi()
    const user = userEvent.setup()
    await renderForm()

    const input = screen.getByLabelText(/Add files/i)
    await user.upload(input, pngFile('shot.png', 2048))

    const item = await screen.findByText('shot.png', { exact: false })
    expect(item).toBeInTheDocument()
    expect(screen.getByText(/2 KB/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Remove shot\.png/ }))
    expect(screen.queryByText(/shot\.png/)).not.toBeInTheDocument()
  })

  it('UI-09 (AC-01): shows the generated Ticket Number on success', async () => {
    mockApi()
    const user = userEvent.setup()
    await renderForm()
    await fillValid(user)

    await user.click(submit())

    expect(await screen.findByText('TKT-2026-000500')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /View Ticket/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create Another/i })).toBeInTheDocument()
    // The form is replaced, so the Ticket cannot be submitted twice.
    expect(screen.queryByLabelText(/^Summary/)).not.toBeInTheDocument()
  })

  it('BR-22: keeps the Ticket and offers a retry when an attachment upload fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/categories')) return Promise.resolve(Response.json(CATEGORIES))
      if (url.includes('/api/related-systems')) {
        return Promise.resolve(Response.json(RELATED_SYSTEMS))
      }
      if (url.includes('/attachments')) {
        return Promise.resolve(
          Response.json({ error: 'Attachment exceeds the 5 MB limit' }, { status: 413 }),
        )
      }
      return Promise.resolve(Response.json(TICKET, { status: 201 }))
    }) as typeof fetch)

    const user = userEvent.setup()
    await renderForm()
    await user.upload(
      screen.getByLabelText(/Add files/i),
      pngFile('shot.png'),
    )
    await fillValid(user)
    await user.click(submit())

    // The Ticket Number is still shown: the Ticket is saved regardless.
    expect(await screen.findByText('TKT-2026-000500')).toBeInTheDocument()

    const failure = await screen.findByRole('alert')
    expect(failure).toHaveTextContent(/could not be uploaded/i)
    expect(within(failure).getByRole('button', { name: /Retry/i })).toBeInTheDocument()
  })

  it('Create Another resets the form to empty', async () => {
    mockApi()
    const user = userEvent.setup()
    await renderForm()
    await fillValid(user)
    await user.click(submit())

    await user.click(await screen.findByRole('button', { name: /Create Another/i }))

    await waitFor(() => {
      expect((screen.getByLabelText(/^Summary/) as HTMLInputElement).value).toBe('')
    })
    expect((screen.getByLabelText(/^Category/) as HTMLSelectElement).value).toBe('')
    expect(screen.queryByText('TKT-2026-000500')).not.toBeInTheDocument()
  })

  it('UI-14 (AC-26): every control is reachable by keyboard, including Requester', async () => {
    mockApi()
    const user = userEvent.setup()
    await renderForm()

    const reachable: string[] = []
    for (let i = 0; i < 14; i += 1) {
      await user.tab()
      const active = document.activeElement as HTMLElement | null
      if (active?.id) reachable.push(active.id)
    }

    // The read-only fields stay in the tab order so their values can be read;
    // a `disabled` attribute would remove them (ui-spec.md §3, §9).
    expect(reachable).toContain('ticket-requester')
    expect(reachable).toContain('category')
    expect(reachable).toContain('related-system')
    expect(reachable).toContain('requested-priority')
    expect(reachable).toContain('summary')
    expect(reachable).toContain('description')
    expect(reachable).toContain('attachments')
  })

  it('shows a retryable failure state when the reference data cannot load', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'))
    window.history.pushState({}, '', '/tickets/new')
    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Unable to load the form/i)
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
  })
})
