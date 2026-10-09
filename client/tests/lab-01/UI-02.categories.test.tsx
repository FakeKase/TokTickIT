import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SystemStatusPage } from '../../src/pages/SystemStatusPage'

// Rendered as the page rather than through <App />: Lab 3 put every screen
// behind a session, and these tests are about the screen itself. Since Lab 4
// it is System Status, for an Administrator at /system-status: it checks on
// arrival, and its "Submit Request" buttons are gone (Lab 4 ui-spec.md §8).
// Who may open it is UI-28 in tests/lab-04/SystemStatus.test.tsx.
// UI-02 (Issue 3): The app fetches and displays the four IT request categories
// in a grid layout. Tests cover success (categories render) and failure (error
// message when fetch fails).
describe('UI-02 Category list', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const mockCategories = [
    { id: 1, name: 'Hardware', description: 'Computer, printer, monitor, and other equipment issues' },
    { id: 2, name: 'Software', description: 'Application, license, and installation problems' },
    { id: 3, name: 'Network', description: 'Internet, VPN, WiFi, and connectivity issues' },
    { id: 4, name: 'Other', description: 'Everything else' },
  ]

  it('loads and displays all four categories on arrival', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ status: 'ok', service: 'TokTickIT API' }),
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json(mockCategories),
    )

    render(
      <MemoryRouter>
        <SystemStatusPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Hardware')).toBeInTheDocument()
    })
    expect(screen.getByText('Software')).toBeInTheDocument()
    expect(screen.getByText('Network')).toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()
  })

  it('displays category descriptions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ status: 'ok', service: 'TokTickIT API' }),
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json(mockCategories),
    )

    render(
      <MemoryRouter>
        <SystemStatusPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(
        screen.getByText(/Computer, printer, monitor/),
      ).toBeInTheDocument()
    })
    expect(
      screen.getByText(/Application, license/),
    ).toBeInTheDocument()
  })

  it('shows an error message when categories fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ status: 'ok', service: 'TokTickIT API' }),
    )
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    render(
      <MemoryRouter>
        <SystemStatusPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText(/Unable to connect to TokTickIT API/)).toBeInTheDocument()
    })
  })

  it('shows Online badge when system is up', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ status: 'ok', service: 'TokTickIT API' }),
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json(mockCategories),
    )

    render(
      <MemoryRouter>
        <SystemStatusPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Online')).toBeInTheDocument()
    })
  })
})
