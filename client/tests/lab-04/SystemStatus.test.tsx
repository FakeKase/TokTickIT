import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuthenticatedUser } from '../../src/api'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'
import { hrefOf } from './dashboardFixtures'

// UI-28 (Lab 4 FR-16, AC-45; ui-spec.md §8). The screen's own behaviour is
// still Lab 1's UI-01 to UI-03; this file is about where it now lives, who may
// open it, and what was taken out of it.

const CATEGORIES = [
  { id: 1, name: 'Hardware', description: 'Computer, printer and monitor issues' },
  { id: 2, name: 'Software', description: 'Application and licence problems' },
]

let signedIn: AuthenticatedUser
let healthCalls = 0

function mockApi(health: () => Promise<Response> | Response = () => Response.json({ status: 'ok', service: 'TokTickIT API' })) {
  healthCalls = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL) => {
    const url = String(input)
    const auth = authRoutes(signedIn)(url)
    if (auth) return auth
    if (url.includes('/api/health')) {
      healthCalls += 1
      return Promise.resolve(health())
    }
    if (url.includes('/api/categories')) return Promise.resolve(Response.json(CATEGORIES))
    return Promise.resolve(Response.json([]))
  }) as typeof fetch)
}

async function openAs(role: AuthenticatedUser['role']) {
  signedIn = authUser({ id: 3, name: 'Alex Morgan', role })
  window.history.pushState({}, '', '/system-status')
  await renderApp()
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('UI-28 System Status (FR-16, AC-45)', () => {
  it('shows an Administrator that the API and database answer, and the Categories', async () => {
    mockApi()
    await openAs('ADMINISTRATOR')

    expect(await screen.findByText('Online')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'System Status' })).toBeInTheDocument()
    expect(screen.getByText('TokTickIT API is answering')).toBeInTheDocument()
    expect(screen.getByText('2 Categories read')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Hardware' })).toBeInTheDocument()
    expect(screen.getByText('Application and licence problems')).toBeInTheDocument()
  })

  it('has no Submit Request control, and no button other than Check again', async () => {
    mockApi()
    await openAs('ADMINISTRATOR')
    await screen.findByText('Online')

    expect(screen.queryByText(/Submit Request/i)).not.toBeInTheDocument()
    const main = within(screen.getByRole('main'))
    expect(main.getAllByRole('button').map((button) => button.textContent)).toEqual(['Check again'])
    expect(main.queryByRole('link')).not.toBeInTheDocument()
  })

  it('checks again when asked', async () => {
    mockApi()
    await openAs('ADMINISTRATOR')
    await screen.findByText('Online')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }))

    expect(await screen.findByText('Online')).toBeInTheDocument()
    expect(healthCalls).toBe(2)
  })

  it('shows a failure with a retry when the API does not answer', async () => {
    mockApi(() => new Response('', { status: 500 }))
    await openAs('ADMINISTRATOR')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to connect to TokTickIT API')
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(screen.queryByText('Hardware')).not.toBeInTheDocument()
  })

  it.each([
    ['REQUESTER', '/dashboard'],
    ['IT_STAFF', '/staff/dashboard'],
  ] as const)('is Forbidden for %s, with a link to their Dashboard, and checks nothing', async (role, home) => {
    mockApi()
    await openAs(role)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/do not have permission/i)
    expect(hrefOf(within(alert).getByRole('link'))).toBe(home)
    expect(screen.queryByRole('heading', { name: 'System Status' })).not.toBeInTheDocument()
    expect(healthCalls).toBe(0)
  })
})
