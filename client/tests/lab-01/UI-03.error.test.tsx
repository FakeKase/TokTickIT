import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../src/App'

// UI-03: when the API cannot be reached the user must be told, rather than the
// page silently doing nothing. Both failure modes are covered: the request
// never lands (network error) and it lands but fails (5xx).
describe('UI-03 API failure', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a useful error message when the backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'))
    const user = userEvent.setup()

    render(<App />)
    await user.click(screen.getByRole('button', { name: /Check System/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Unable to connect to TokTickIT API/i,
    )
    expect(screen.getByText(/Offline/i)).toBeInTheDocument()
  })

  it('treats a non-2xx response as offline too', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 500 }),
    )
    const user = userEvent.setup()

    render(<App />)
    await user.click(screen.getByRole('button', { name: /Check System/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Unable to connect to TokTickIT API/i,
    )
  })

  it('reports Online when the API answers', async () => {
    // First fetch is health check, second is categories
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ status: 'ok', service: 'TokTickIT API' }),
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json([
        { id: 1, name: 'Hardware', description: 'Hardware issues' },
      ]),
    )
    const user = userEvent.setup()

    render(<App />)
    await user.click(screen.getByRole('button', { name: /Check System/i }))

    expect(await screen.findByText(/Online/i)).toBeInTheDocument()
  })
})
