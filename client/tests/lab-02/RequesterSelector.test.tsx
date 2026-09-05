import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../src/App'
import { REQUESTER_STORAGE_KEY } from '../../src/requester/requesterContext'

// UI-01, UI-02, UI-03 (Issue 14): the Development Requester Selection screen
// (ui-spec.md §6.1). Renders the real <App /> at /select-requester so the
// route, provider, and screen are exercised together rather than in isolation.

const ACTIVE_REQUESTERS = [
  { id: 1, name: 'Peter Parker', email: 'peter.parker@toktickit.test' },
  { id: 2, name: 'Ned Leeds', email: 'ned.leeds@toktickit.test' },
  { id: 3, name: 'Michelle Jones', email: 'michelle.jones@toktickit.test' },
  { id: 4, name: 'Roronoa Zoro', email: 'roronoa.zoro@toktickit.test' },
]

function renderSelector() {
  window.history.pushState({}, '', '/select-requester')
  return render(<App />)
}

describe('Development Requester Selection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('UI-01 (BR-04): lists only the active Requesters the API returned', async () => {
    // The API filters inactive rows (API-18); the screen must not reintroduce
    // one, so the inactive seed Requester never reaches the dropdown.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(ACTIVE_REQUESTERS))

    renderSelector()

    const select = await screen.findByRole('combobox', { name: /Development Requester/i })
    const optionLabels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)

    expect(optionLabels).toEqual([
      'Choose a Requester…',
      'Peter Parker',
      'Ned Leeds',
      'Michelle Jones',
      'Roronoa Zoro',
    ])
    expect(screen.queryByText('David Kim')).not.toBeInTheDocument()
  })

  it('explains that this is testing scaffolding, not a login (BR-03, handout §8.1)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(ACTIVE_REQUESTERS))

    renderSelector()

    expect(
      await screen.findByText(
        /Select a Development Requester to test requester-specific ticket behavior\. This is not a login screen\./i,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Authentication and role-based access will be introduced in Lab 3\./i),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('keeps Continue disabled until a Requester is chosen', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(ACTIVE_REQUESTERS))
    const user = userEvent.setup()

    renderSelector()

    const continueButton = await screen.findByRole('button', { name: /Continue/i })
    expect(continueButton).toBeDisabled()

    await user.selectOptions(
      screen.getByRole('combobox', { name: /Development Requester/i }),
      '2',
    )

    expect(continueButton).toBeEnabled()
  })

  it('stores the chosen Requester and shows it in the header (BR-05)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(ACTIVE_REQUESTERS))
    const user = userEvent.setup()

    renderSelector()

    await user.selectOptions(
      await screen.findByRole('combobox', { name: /Development Requester/i }),
      '2',
    )
    await user.click(screen.getByRole('button', { name: /Continue/i }))

    await waitFor(() => {
      expect(screen.getByText('Ned Leeds')).toBeInTheDocument()
    })
    expect(JSON.parse(window.localStorage.getItem(REQUESTER_STORAGE_KEY) ?? 'null')).toEqual(
      ACTIVE_REQUESTERS[1],
    )
    expect(screen.getByRole('link', { name: /Change Requester/i })).toBeInTheDocument()
  })

  it('UI-02 (AC-23, BR-27): shows a safe empty state with nothing selectable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([]))

    renderSelector()

    expect(
      await screen.findByText(/No active Development Requesters are available/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue/i })).toBeDisabled()
  })

  it('UI-03 (AC-24): shows a safe failure state with a working Retry', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(Response.json(ACTIVE_REQUESTERS))
    const user = userEvent.setup()

    renderSelector()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Unable to load Development Requesters/i)
    expect(alert).not.toHaveTextContent(/Failed to fetch/i)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Retry/i }))

    expect(
      await screen.findByRole('combobox', { name: /Development Requester/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('treats a non-2xx response as a failure too', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }))

    renderSelector()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Unable to load Development Requesters/i,
    )
  })
})
