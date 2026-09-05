import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../src/App'
import { REQUESTER_STORAGE_KEY } from '../../src/requester/requesterContext'

// Issue 14: the selected-Requester context and its route guard. Covers AC-02
// (the guard) at the router level; the My Tickets screen's own AC-02 row
// (UI-04) lands with that screen in Issue 16.

const REQUESTERS = [
  { id: 1, name: 'Peter Parker', email: 'peter.parker@toktickit.test' },
  { id: 2, name: 'Ned Leeds', email: 'ned.leeds@toktickit.test' },
]

function goTo(path: string) {
  window.history.pushState({}, '', path)
}

describe('Selected Requester context and guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(REQUESTERS))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  it.each(['/tickets', '/tickets/new', '/tickets/42'])(
    'AC-02: %s redirects to the Selector when no Requester is selected',
    async (path) => {
      goTo(path)
      render(<App />)

      expect(
        await screen.findByRole('combobox', { name: /Development Requester/i }),
      ).toBeInTheDocument()
      expect(window.location.pathname).toBe('/select-requester')
    },
  )

  it('returns to the blocked page after a Requester is chosen', async () => {
    const user = userEvent.setup()
    goTo('/tickets/new')
    render(<App />)

    await user.selectOptions(
      await screen.findByRole('combobox', { name: /Development Requester/i }),
      '1',
    )
    await user.click(screen.getByRole('button', { name: /Continue/i }))

    await waitFor(() => {
      expect(window.location.pathname).toBe('/tickets/new')
    })
  })

  it('restores a previously selected Requester on a fresh page load', async () => {
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, JSON.stringify(REQUESTERS[0]))
    goTo('/tickets')

    render(<App />)

    expect(await screen.findByText('Peter Parker')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/tickets')
  })

  it('BR-05: choosing a different Requester replaces the previous selection', async () => {
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, JSON.stringify(REQUESTERS[0]))
    const user = userEvent.setup()
    goTo('/tickets')
    render(<App />)

    await user.click(await screen.findByRole('link', { name: /Change Requester/i }))
    await user.selectOptions(
      await screen.findByRole('combobox', { name: /Development Requester/i }),
      '2',
    )
    await user.click(screen.getByRole('button', { name: /Continue/i }))

    await waitFor(() => {
      expect(screen.getByText('Ned Leeds')).toBeInTheDocument()
    })
    expect(screen.queryByText('Peter Parker')).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(REQUESTER_STORAGE_KEY) ?? 'null')).toEqual(
      REQUESTERS[1],
    )
  })

  it('ignores a corrupted stored selection instead of crashing', async () => {
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, '{"id":"not-a-number"}')
    goTo('/tickets')

    render(<App />)

    // Falls back to "nothing selected", so the guard sends the user to the selector.
    expect(
      await screen.findByRole('combobox', { name: /Development Requester/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('No Requester selected')).toBeInTheDocument()
  })

  it('leaves unguarded routes reachable without a Requester', async () => {
    goTo('/')

    render(<App />)

    expect(screen.getByRole('button', { name: /Check System/i })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
  })
})
