import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SystemStatusPage } from '../../src/pages/SystemStatusPage'

// Rendered as the page rather than through <App />: Lab 3 put every screen
// behind a session, and these tests are about the screen itself. Since Lab 4
// it is System Status, for an Administrator at /system-status: it checks on
// arrival, and its "Submit Request" buttons are gone (Lab 4 ui-spec.md §8).
// Who may open it is UI-28 in tests/lab-04/SystemStatus.test.tsx.
// UI-01: the app identifies itself before any interaction.
describe('UI-01 TokTickIT heading', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ status: 'ok', service: 'TokTickIT API' }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the screen heading', async () => {
    render(
      <MemoryRouter>
        <SystemStatusPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'System Status' })).toBeInTheDocument()
  })

  it('offers a way to check again', async () => {
    render(
      <MemoryRouter>
        <SystemStatusPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: /Check again/i })).toBeInTheDocument()
  })
})
