import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../src/App'
import { REQUESTER_STORAGE_KEY } from '../../src/requester/requesterContext'

// UI-13 (AC-18, AC-20, AC-22): the Ticket Detail attachment panel.

const REQUESTER = { id: 1, name: 'Peter Parker', email: 'peter.parker@toktickit.test' }

function attachment(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    ticketId: 42,
    originalFilename: `file-${id}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    isRemoved: false,
    removedAt: null,
    removedReason: null,
    createdAt: '2026-09-01T09:00:00.000Z',
    ...overrides,
  }
}

function ticketWith(attachments: ReturnType<typeof attachment>[]) {
  return {
    id: 42,
    ticketNumber: 'TKT-2026-000042',
    requester: { id: 1, name: 'Peter Parker' },
    category: { id: 2, name: 'Hardware' },
    relatedSystem: { id: 3, name: 'Corporate Laptop' },
    summary: 'Projector will not power on',
    description: 'No lights at all.',
    requestedPriority: 'HIGH',
    currentStatus: 'NEW',
    createdAt: '2026-09-01T09:14:00.000Z',
    updatedAt: '2026-09-02T11:00:00.000Z',
    attachments,
  }
}

interface Handlers {
  detail: ReturnType<typeof ticketWith>
  upload?: () => Promise<Response>
  remove?: () => Promise<Response>
}

function mockApi({ detail, upload, remove }: Handlers) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(((
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input)
    if (url.includes('/attachments') && init?.method === 'POST') {
      return upload
        ? upload()
        : Promise.resolve(Response.json(attachment(99), { status: 201 }))
    }
    if (/\/api\/attachments\/\d+$/.test(url) && init?.method === 'DELETE') {
      return remove
        ? remove()
        : Promise.resolve(
            Response.json(
              attachment(1, {
                isRemoved: true,
                removedAt: '2026-09-03T10:00:00.000Z',
                removedReason: 'Wrong screenshot',
              }),
            ),
          )
    }
    if (/\/api\/tickets\/\d+\?/.test(url)) return Promise.resolve(Response.json(detail))
    return Promise.resolve(Response.json([]))
  }) as typeof fetch)
}

async function renderPanel(handlers: Handlers) {
  const spy = mockApi(handlers)
  window.history.pushState({}, '', '/tickets/42')
  render(<App />)
  await screen.findByText('TKT-2026-000042')
  return spy
}

const pdf = (name = 'new.pdf') =>
  new File([new Uint8Array(512)], name, { type: 'application/pdf' })

describe('Ticket Detail attachments', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, JSON.stringify(REQUESTER))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('lists active attachments with a Download link carrying the requesterId', async () => {
    await renderPanel({ detail: ticketWith([attachment(1)]) })

    const download = screen.getByRole('link', { name: /Download/i })
    expect(download).toHaveAttribute('href', expect.stringContaining('/api/attachments/1/download'))
    expect(download).toHaveAttribute('href', expect.stringContaining('requesterId=1'))
  })

  it('UI-13 (AC-18): a new attachment appears without a reload', async () => {
    const user = userEvent.setup()
    await renderPanel({ detail: ticketWith([attachment(1)]) })

    await user.upload(screen.getByLabelText(/Add an attachment/i), pdf())

    expect(await screen.findByText('file-99.pdf')).toBeInTheDocument()
    // The existing row is still there — the list was appended to, not replaced.
    expect(screen.getByText('file-1.pdf')).toBeInTheDocument()
  })

  it('UI-13 (AC-20): a removed attachment keeps its row, badge and reason, and loses Download', async () => {
    const user = userEvent.setup()
    await renderPanel({ detail: ticketWith([attachment(1)]) })

    await user.click(screen.getByRole('button', { name: /^Remove$/ }))
    await user.type(screen.getByLabelText(/Reason for removal/i), 'Wrong screenshot')
    await user.click(screen.getByRole('button', { name: /Confirm removal/i }))

    expect(await screen.findByText('Removed')).toBeInTheDocument()
    // BR-24: still listed as metadata.
    expect(screen.getByText('file-1.pdf')).toBeInTheDocument()
    expect(screen.getByText(/Wrong screenshot/)).toBeInTheDocument()
    // BR-24/BR-26: the action is gone entirely, not disabled.
    expect(screen.queryByRole('link', { name: /Download/i })).not.toBeInTheDocument()
  })

  it('AC-22: blocks removal with no reason, and sends no request', async () => {
    const user = userEvent.setup()
    const spy = await renderPanel({ detail: ticketWith([attachment(1)]) })

    await user.click(screen.getByRole('button', { name: /^Remove$/ }))
    const before = spy.mock.calls.length
    await user.click(screen.getByRole('button', { name: /Confirm removal/i }))

    expect(await screen.findByText(/at least 3 characters/i)).toBeInTheDocument()
    expect(spy.mock.calls.length).toBe(before)
    expect(screen.queryByText('Removed')).not.toBeInTheDocument()
  })

  it('AC-22: a whitespace-only reason does not count', async () => {
    const user = userEvent.setup()
    const spy = await renderPanel({ detail: ticketWith([attachment(1)]) })

    await user.click(screen.getByRole('button', { name: /^Remove$/ }))
    await user.type(screen.getByLabelText(/Reason for removal/i), '   ')
    const before = spy.mock.calls.length
    await user.click(screen.getByRole('button', { name: /Confirm removal/i }))

    expect(await screen.findByText(/at least 3 characters/i)).toBeInTheDocument()
    expect(spy.mock.calls.length).toBe(before)
  })

  it('cancelling removal leaves the attachment untouched', async () => {
    const user = userEvent.setup()
    await renderPanel({ detail: ticketWith([attachment(1)]) })

    await user.click(screen.getByRole('button', { name: /^Remove$/ }))
    await user.click(screen.getByRole('button', { name: /^Cancel$/ }))

    expect(screen.queryByLabelText(/Reason for removal/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Download/i })).toBeInTheDocument()
  })

  it('renders an already-removed attachment as metadata only', async () => {
    await renderPanel({
      detail: ticketWith([
        attachment(1, {
          isRemoved: true,
          removedAt: '2026-09-02T10:00:00.000Z',
          removedReason: 'Uploaded by mistake',
        }),
      ]),
    })

    expect(screen.getByText('Removed')).toBeInTheDocument()
    expect(screen.getByText(/Uploaded by mistake/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Download/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove$/ })).not.toBeInTheDocument()
  })

  it('BR-19: rejects an unsupported type before any upload request', async () => {
    const spy = await renderPanel({ detail: ticketWith([]) })

    const before = spy.mock.calls.length
    // fireEvent, not userEvent: userEvent honours `accept` and would discard
    // the file before the component could reject it.
    fireEvent.change(screen.getByLabelText(/Add an attachment/i), {
      target: { files: [new File(['MZ'], 'payload.exe', { type: 'application/x-msdownload' })] },
    })

    expect(await screen.findByText(/not a permitted type/i)).toBeInTheDocument()
    expect(spy.mock.calls.length).toBe(before)
  })

  it('BR-20: rejects a file over 5 MB before any upload request', async () => {
    const user = userEvent.setup()
    const spy = await renderPanel({ detail: ticketWith([]) })

    const before = spy.mock.calls.length
    await user.upload(
      screen.getByLabelText(/Add an attachment/i),
      new File([new Uint8Array(6 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' }),
    )

    expect(await screen.findByText(/larger than 5 MB/i)).toBeInTheDocument()
    expect(spy.mock.calls.length).toBe(before)
  })

  it('BR-21: disables the picker at five active attachments and says why', async () => {
    await renderPanel({
      detail: ticketWith([1, 2, 3, 4, 5].map((n) => attachment(n))),
    })

    expect(screen.getByLabelText(/Add an attachment/i)).toBeDisabled()
    expect(screen.getByText(/maximum of 5 active attachments/i)).toBeInTheDocument()
  })

  it('BR-21: a removed attachment does not count toward the cap', async () => {
    await renderPanel({
      detail: ticketWith([
        ...[1, 2, 3, 4].map((n) => attachment(n)),
        attachment(5, { isRemoved: true, removedReason: 'Freed a slot' }),
      ]),
    })

    expect(screen.getByLabelText(/Add an attachment/i)).toBeEnabled()
  })

  it('surfaces a server rejection without dropping the row', async () => {
    const user = userEvent.setup()
    await renderPanel({
      detail: ticketWith([attachment(1)]),
      remove: () =>
        Promise.resolve(
          Response.json({ error: 'This Attachment was already removed' }, { status: 409 }),
        ),
    })

    await user.click(screen.getByRole('button', { name: /^Remove$/ }))
    await user.type(screen.getByLabelText(/Reason for removal/i), 'Trying again')
    await user.click(screen.getByRole('button', { name: /Confirm removal/i }))

    expect(await screen.findByText(/already removed/i)).toBeInTheDocument()
    expect(screen.getByText('file-1.pdf')).toBeInTheDocument()
  })

  it('reports an upload failure without losing the existing list', async () => {
    const user = userEvent.setup()
    await renderPanel({
      detail: ticketWith([attachment(1)]),
      upload: () =>
        Promise.resolve(
          Response.json({ error: 'Attachment exceeds the 5 MB limit' }, { status: 413 }),
        ),
    })

    await user.upload(screen.getByLabelText(/Add an attachment/i), pdf())

    expect(await screen.findByText(/exceeds the 5 MB limit/i)).toBeInTheDocument()
    expect(screen.getByText('file-1.pdf')).toBeInTheDocument()
  })

  it('keeps each row’s removal reason separate', async () => {
    const user = userEvent.setup()
    await renderPanel({ detail: ticketWith([attachment(1), attachment(2)]) })

    const rows = screen.getAllByRole('button', { name: /^Remove$/ })
    await user.click(rows[0])
    await user.type(screen.getByLabelText(/Reason for removal/i), 'First row reason')

    // Opening another row's confirmation must not inherit that text.
    await user.click(screen.getByRole('button', { name: /^Cancel$/ }))
    await user.click(screen.getAllByRole('button', { name: /^Remove$/ })[1])

    await waitFor(() => {
      expect((screen.getByLabelText(/Reason for removal/i) as HTMLInputElement).value).toBe('')
    })
  })

  it('shows an empty message when the Ticket has no attachments', async () => {
    await renderPanel({ detail: ticketWith([]) })

    const panel = within(screen.getByRole('region', { name: /Attachments/i }))
    expect(panel.getByText(/No attachments on this Ticket/i)).toBeInTheDocument()
  })
})
