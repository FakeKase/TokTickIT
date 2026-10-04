import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ManagedUser } from '../../src/api'
import { authRoutes, authUser } from '../helpers/auth'
import { renderApp } from '../helpers/renderApp'

// UI-18 to UI-22 (AC-35 to AC-41; BR-32, BR-33, BR-34, BR-36).
//
// The table and the mobile cards are both in the DOM, as on the other list
// screens, so anything about "a row" is asserted inside the table.

const ADA = { id: 2, name: 'Ada Admin', email: 'ada.admin@toktickit.test', role: 'ADMINISTRATOR' as const }
let signedIn = authUser(ADA)

const person = (id: number, overrides: Partial<ManagedUser> = {}): ManagedUser => ({
  id,
  name: `Person ${id}`,
  email: `person${id}@toktickit.test`,
  role: 'REQUESTER',
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-09-01T09:00:00.000Z',
  isLastActiveAdministrator: false,
  ...overrides,
})

const USERS: ManagedUser[] = [
  person(2, { ...ADA }),
  person(9, { name: 'Sarah Chen', email: 'sarah.chen@toktickit.test', role: 'IT_STAFF' }),
  person(1, { name: 'Peter Parker', email: 'peter.parker@toktickit.test' }),
  person(7, { name: 'Viktor Hale', email: 'viktor.hale@toktickit.test', role: 'IT_STAFF', isActive: false }),
]

interface Sent {
  method: string
  path: string
  body: Record<string, unknown>
}

let sent: Sent[] = []
let listQueries: Record<string, string>[] = []
let server: ManagedUser[]

interface Handlers {
  list?: (query: URLSearchParams) => Response | Promise<Response>
  write?: (request: Sent) => Response | Promise<Response> | undefined
}

function mockApi(handlers: Handlers = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const auth = authRoutes(signedIn)(url)
    if (auth) return auth

    const parsed = new URL(url, 'http://localhost')
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const answer = (value: Response | Promise<Response>) => Promise.resolve(value)

    if (parsed.pathname === '/api/users' && method === 'GET') {
      listQueries.push(Object.fromEntries(parsed.searchParams))
      return answer(handlers.list?.(parsed.searchParams) ?? Response.json(server))
    }

    if (parsed.pathname.startsWith('/api/users')) {
      const request = { method, path: parsed.pathname, body }
      sent.push(request)
      const custom = handlers.write?.(request)
      if (custom) return answer(custom)

      // The default server applies the write, so the reload shows it.
      if (method === 'POST' && parsed.pathname === '/api/users') {
        const created = person(100, { ...(body as Partial<ManagedUser>), mustChangePassword: true })
        server = [...server, created]
        return answer(Response.json(created, { status: 201 }))
      }
      const id = Number(parsed.pathname.split('/')[3])
      if (method === 'PATCH') {
        server = server.map((user) => (user.id === id ? { ...user, ...(body as Partial<ManagedUser>) } : user))
        return answer(Response.json(server.find((user) => user.id === id)))
      }
      if (parsed.pathname.endsWith('/initial-password')) {
        return answer(Response.json({ user: { ...server.find((user) => user.id === id), mustChangePassword: true } }))
      }
    }
    return answer(Response.json([]))
  }) as typeof fetch)
}

const openScreen = async () => {
  window.history.pushState({}, '', '/admin/users')
  await renderApp()
  await screen.findByRole('heading', { name: 'User Management' })
}

const table = async () => within(await screen.findByRole('table'))
const dialog = () => within(screen.getByRole('dialog'))
const rowFor = async (name: string) =>
  within((await table()).getByText(name).closest('tr') as HTMLElement)

const openEdit = async (name: string) => {
  const user = userEvent.setup()
  await user.click((await table()).getByRole('button', { name: `Edit ${name}` }))
  return user
}

const openCreate = async () => {
  const user = userEvent.setup()
  await table()
  await user.click(screen.getByRole('button', { name: 'New user' }))
  return user
}

const fillValid = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(dialog().getByLabelText(/^Name/), 'Jane Doe')
  await user.type(dialog().getByLabelText(/^Email/), 'jane.doe@toktickit.test')
  await user.click(dialog().getByRole('radio', { name: 'IT Staff' }))
  await user.type(dialog().getByLabelText(/^Initial password/), 'Initial123!')
}

beforeEach(() => {
  vi.restoreAllMocks()
  signedIn = authUser(ADA)
  server = USERS.map((user) => ({ ...user }))
  sent = []
  listQueries = []
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('UI-18 the user list (AC-35, AC-36)', () => {
  it('shows Name, Email, Role, Status and an Edit action for every user', async () => {
    mockApi()
    await openScreen()

    expect((await table()).getAllByRole('row').slice(1)).toHaveLength(4)

    const sarah = await rowFor('Sarah Chen')
    expect(sarah.getByText('sarah.chen@toktickit.test')).toBeInTheDocument()
    expect(sarah.getByText('IT Staff')).toBeInTheDocument()
    expect(sarah.getByText('Active')).toBeInTheDocument()
    expect(sarah.getByRole('button', { name: 'Edit Sarah Chen' })).toBeInTheDocument()

    // Deactivated is not deleted: the account is still listed, and says so.
    expect((await rowFor('Viktor Hale')).getByText('Inactive')).toBeInTheDocument()
  })

  it('marks which row is the person looking', async () => {
    mockApi()
    await openScreen()

    expect((await rowFor('Ada Admin')).getByText('(you)')).toBeInTheDocument()
    expect((await rowFor('Sarah Chen')).queryByText('(you)')).toBeNull()
  })

  it('has no delete action, no pagination and no bulk selection (BR-35, BR-38)', async () => {
    mockApi()
    await openScreen()
    await table()

    expect(screen.queryByRole('button', { name: /delete|remove/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /next|previous/i })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('searches on submit, trimmed, with nothing sent for an untouched filter', async () => {
    mockApi()
    await openScreen()
    await table()
    expect(listQueries).toEqual([{}])

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search'), '  chen ')
    expect(listQueries).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(listQueries[listQueries.length - 1]).toEqual({ search: 'chen' }))
  })

  it('filters by role, combined with the search that is in the box', async () => {
    mockApi()
    await openScreen()
    await table()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search'), 'toktickit')
    await user.selectOptions(screen.getByLabelText('Role'), 'IT_STAFF')

    await waitFor(() =>
      expect(listQueries[listQueries.length - 1]).toEqual({ search: 'toktickit', role: 'IT_STAFF' }),
    )
  })

  it('tells an empty system from a search that matched nobody', async () => {
    mockApi({ list: (query) => Response.json(query.get('search') ? [] : server) })
    await openScreen()
    await table()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search'), 'nobody')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('No users match this search.')).toBeInTheDocument()
    expect(screen.queryByText('No users yet.')).toBeNull()

    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0])
    await table()
    expect(listQueries[listQueries.length - 1]).toEqual({})
    expect(screen.getByLabelText('Search')).toHaveValue('')
  })

  it('says there are no users, and offers nothing to clear, when the list is truly empty', async () => {
    mockApi({ list: () => Response.json([]) })
    await openScreen()

    expect(await screen.findByText('No users yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })
})

describe('UI-19 creating a user (AC-37)', () => {
  it('validates every field before sending anything', async () => {
    mockApi()
    await openScreen()
    const user = await openCreate()

    await user.click(dialog().getByRole('button', { name: 'Create user' }))

    expect(dialog().getByText('Enter a name')).toBeInTheDocument()
    expect(dialog().getByText('Enter an email address')).toBeInTheDocument()
    expect(dialog().getByText('Choose a role')).toBeInTheDocument()
    expect(dialog().getByText('Enter an initial password')).toBeInTheDocument()
    expect(sent).toEqual([])
  })

  it('holds each field to its bounds', async () => {
    mockApi()
    await openScreen()
    const user = await openCreate()

    await user.type(dialog().getByLabelText(/^Name/), 'J')
    await user.type(dialog().getByLabelText(/^Email/), 'not-an-address')
    await user.type(dialog().getByLabelText(/^Initial password/), 'short')
    await user.click(dialog().getByRole('button', { name: 'Create user' }))

    expect(dialog().getByText('Must be at least 2 characters')).toBeInTheDocument()
    expect(dialog().getByText('Enter a valid email address')).toBeInTheDocument()
    expect(dialog().getByText('Must be at least 8 characters')).toBeInTheDocument()
    expect(sent).toEqual([])
  })

  it('counts the password ceiling in bytes, so 25 Thai characters are refused', async () => {
    mockApi()
    await openScreen()
    const user = await openCreate()
    await fillValid(user)

    await user.clear(dialog().getByLabelText(/^Initial password/))
    await user.type(dialog().getByLabelText(/^Initial password/), 'ก'.repeat(25))
    await user.click(dialog().getByRole('button', { name: 'Create user' }))

    expect(dialog().getByText(/at most 72 bytes/)).toBeInTheDocument()
    expect(sent).toEqual([])
  })

  it('sends one request with the form as filled, closes, and says what happens next', async () => {
    mockApi()
    await openScreen()
    const user = await openCreate()
    await fillValid(user)

    await user.click(dialog().getByRole('button', { name: 'Create user' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/api/users',
        body: {
          name: 'Jane Doe',
          email: 'jane.doe@toktickit.test',
          role: 'IT_STAFF',
          isActive: true,
          initialPassword: 'Initial123!',
        },
      },
    ])
    expect(screen.getByRole('status')).toHaveTextContent(
      'Jane Doe was created. They must change their password when they first sign in.',
    )
    // And the list is reloaded, so the new account is in it.
    expect((await table()).getByText('Jane Doe')).toBeInTheDocument()
  })

  it('creates the account switched off when Active is unticked', async () => {
    mockApi()
    await openScreen()
    const user = await openCreate()
    await fillValid(user)

    await user.click(dialog().getByRole('checkbox', { name: 'Active' }))
    await user.click(dialog().getByRole('button', { name: 'Create user' }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].body).toMatchObject({ isActive: false })
  })

  it('offers the three roles as radio buttons with none chosen, and Active ticked', async () => {
    mockApi()
    await openScreen()
    await openCreate()

    const radios = dialog().getAllByRole('radio')
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual([
      'Requester',
      'IT Staff',
      'Administrator',
    ])
    expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true)
    expect(dialog().getByRole('checkbox', { name: 'Active' })).toBeChecked()
  })

  it('does not send twice when the button is pressed twice', async () => {
    let release: (response: Response) => void = () => {}
    mockApi({ write: () => new Promise<Response>((resolve) => (release = resolve)) })
    await openScreen()
    const user = await openCreate()
    await fillValid(user)

    await user.click(dialog().getByRole('button', { name: 'Create user' }))
    expect(await dialog().findByText('Saving…')).toBeInTheDocument()
    // The busy button is disabled, which stops a second click. Submitting the
    // form directly gets past the button, so the form has to refuse it too.
    fireEvent.submit(screen.getByRole('dialog').querySelector('form') as HTMLFormElement)

    expect(sent).toHaveLength(1)
    release(Response.json(person(100), { status: 201 }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows field messages the server sends back for a 400', async () => {
    mockApi({
      write: () =>
        Response.json(
          { error: 'Validation failed', fields: { name: 'Must be at most 80 characters' } },
          { status: 400 },
        ),
    })
    await openScreen()
    const user = await openCreate()
    await fillValid(user)

    await user.click(dialog().getByRole('button', { name: 'Create user' }))

    expect(await dialog().findByText('Must be at most 80 characters')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps the dialog and the typing when the save fails, and repeats nothing the server said', async () => {
    mockApi({ write: () => Response.json({ error: 'duplicate key value violates "User_email_key"' }, { status: 500 }) })
    await openScreen()
    const user = await openCreate()
    await fillValid(user)

    await user.click(dialog().getByRole('button', { name: 'Create user' }))

    const alert = await dialog().findByText('The user could not be saved. Please try again.')
    expect(alert).toBeInTheDocument()
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/duplicate key|User_email_key/)
    expect(dialog().getByLabelText(/^Name/)).toHaveValue('Jane Doe')
  })
})

describe('UI-20 duplicate email (AC-38)', () => {
  it('puts the message on the email field, not in a banner', async () => {
    mockApi({ write: () => Response.json({ error: 'That email address is already in use' }, { status: 409 }) })
    await openScreen()
    const user = await openCreate()
    await fillValid(user)

    await user.click(dialog().getByRole('button', { name: 'Create user' }))

    const email = dialog().getByLabelText(/^Email/)
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
    expect(email).toHaveAccessibleDescription('That email address is already in use')
    // Exactly one place says it, and it is the field.
    expect(dialog().getAllByText('That email address is already in use')).toHaveLength(1)
    expect(dialog().getByLabelText(/^Name/)).not.toHaveAttribute('aria-invalid')
  })

  it('does the same on an edit', async () => {
    mockApi({ write: () => Response.json({ error: 'That email address is already in use' }, { status: 409 }) })
    await openScreen()
    const user = await openEdit('Peter Parker')

    await user.clear(dialog().getByLabelText(/^Email/))
    await user.type(dialog().getByLabelText(/^Email/), 'sarah.chen@toktickit.test')
    await user.click(dialog().getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(dialog().getByLabelText(/^Email/)).toHaveAccessibleDescription(
        'That email address is already in use',
      ),
    )
  })
})

describe('editing a user (FR-23)', () => {
  it('opens with the user’s current details and no password field', async () => {
    mockApi()
    await openScreen()
    await openEdit('Sarah Chen')

    expect(screen.getByRole('dialog', { name: 'Edit Sarah Chen' })).toBeInTheDocument()
    expect(dialog().getByLabelText(/^Name/)).toHaveValue('Sarah Chen')
    expect(dialog().getByLabelText(/^Email/)).toHaveValue('sarah.chen@toktickit.test')
    expect(dialog().getByRole('radio', { name: 'IT Staff' })).toBeChecked()
    expect(dialog().getByRole('checkbox', { name: 'Active' })).toBeChecked()
    expect(dialog().queryByLabelText(/^Initial password/)).toBeNull()
  })

  it('sends only what changed', async () => {
    mockApi()
    await openScreen()
    const user = await openEdit('Sarah Chen')

    await user.click(dialog().getByRole('radio', { name: 'Administrator' }))
    await user.click(dialog().getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(sent).toEqual([{ method: 'PATCH', path: '/api/users/9', body: { role: 'ADMINISTRATOR' } }])
    expect(screen.getByRole('status')).toHaveTextContent('Sarah Chen was updated.')
    expect((await rowFor('Sarah Chen')).getByText('Administrator')).toBeInTheDocument()
  })

  it('sends nothing at all when nothing changed', async () => {
    mockApi()
    await openScreen()
    const user = await openEdit('Sarah Chen')

    await user.click(dialog().getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(sent).toEqual([])
  })

  it('deactivates another user', async () => {
    mockApi()
    await openScreen()
    const user = await openEdit('Sarah Chen')

    await user.click(dialog().getByRole('checkbox', { name: 'Active' }))
    await user.click(dialog().getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(sent).toEqual([{ method: 'PATCH', path: '/api/users/9', body: { isActive: false } }]))
    expect((await rowFor('Sarah Chen')).getByText('Inactive')).toBeInTheDocument()
  })

  it('does not carry one person’s edits into the next person’s dialog', async () => {
    mockApi()
    await openScreen()
    const user = await openEdit('Sarah Chen')
    await user.clear(dialog().getByLabelText(/^Name/))
    await user.type(dialog().getByLabelText(/^Name/), 'Abandoned Edit')
    await user.click(dialog().getByRole('button', { name: 'Cancel' }))

    await user.click((await table()).getByRole('button', { name: 'Edit Peter Parker' }))

    expect(dialog().getByLabelText(/^Name/)).toHaveValue('Peter Parker')
    expect(sent).toEqual([])
  })
})

describe('UI-21 the guard-rails (AC-39, AC-40)', () => {
  it('disables Active on your own account, with the reason beside it', async () => {
    mockApi()
    await openScreen()
    await openEdit('Ada Admin')

    const active = dialog().getByRole('checkbox', { name: 'Active' })
    expect(active).toBeDisabled()
    expect(active).toBeChecked()
    expect(active).toHaveAccessibleDescription('You cannot deactivate your own account.')
    expect(dialog().getByText('You cannot deactivate your own account.')).toBeVisible()
    // With a second Administrator around, their role is still theirs to change.
    expect(dialog().getByRole('radio', { name: 'IT Staff' })).toBeEnabled()
  })

  it('disables Active and Role on the last active Administrator, with the reason beside them', async () => {
    signedIn = authUser({ id: 9, name: 'Sarah Chen', role: 'ADMINISTRATOR' })
    server = server.map((user) =>
      user.id === 2 ? { ...user, isLastActiveAdministrator: true } : user,
    )
    mockApi()
    await openScreen()
    await openEdit('Ada Admin')

    const reason = 'This is the last active Administrator. Promote another Administrator first.'
    expect(dialog().getByRole('checkbox', { name: 'Active' })).toBeDisabled()
    expect(dialog().getByRole('checkbox', { name: 'Active' })).toHaveAccessibleDescription(reason)
    for (const radio of dialog().getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(dialog().getAllByText(reason).length).toBe(2)

    // Their name and email are still editable.
    expect(dialog().getByLabelText(/^Name/)).toBeEnabled()
  })

  it('leaves both enabled for anyone else', async () => {
    mockApi()
    await openScreen()
    await openEdit('Sarah Chen')

    expect(dialog().getByRole('checkbox', { name: 'Active' })).toBeEnabled()
    for (const radio of dialog().getAllByRole('radio')) expect(radio).toBeEnabled()
    expect(dialog().queryByText(/last active Administrator|your own account/)).toBeNull()
  })

  it('shows the server’s refusal when it disagrees with what the dialog allowed', async () => {
    // The list said there were two Administrators; by the time of the save
    // there is one. The server is the one that knows.
    mockApi({
      write: () =>
        Response.json({ error: 'The system must keep at least one active Administrator' }, { status: 409 }),
    })
    await openScreen()
    const user = await openEdit('Ada Admin')

    await user.click(dialog().getByRole('radio', { name: 'IT Staff' }))
    await user.click(dialog().getByRole('button', { name: 'Save changes' }))

    expect(await dialog().findByRole('alert')).toHaveTextContent(
      'The system must keep at least one active Administrator',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('UI-22 setting a new initial password (AC-41)', () => {
  it('asks first, and sends nothing until confirmed', async () => {
    mockApi()
    await openScreen()
    const user = await openEdit('Sarah Chen')

    await user.click(dialog().getByRole('button', { name: 'Set new initial password' }))

    expect(dialog().getByLabelText('New initial password for Sarah Chen')).toBeInTheDocument()
    expect(dialog().getByText(/signs them out everywhere/)).toBeInTheDocument()
    expect(sent).toEqual([])

    await user.click(dialog().getByRole('button', { name: 'Keep current password' }))
    expect(dialog().queryByLabelText('New initial password for Sarah Chen')).toBeNull()
    expect(sent).toEqual([])
  })

  it('sends one request on confirmation and says the user must change it', async () => {
    mockApi()
    await openScreen()
    const user = await openEdit('Sarah Chen')

    await user.click(dialog().getByRole('button', { name: 'Set new initial password' }))
    await user.type(dialog().getByLabelText('New initial password for Sarah Chen'), 'Temporary99!')
    await user.click(dialog().getByRole('button', { name: 'Confirm new password' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(sent).toEqual([
      { method: 'POST', path: '/api/users/9/initial-password', body: { initialPassword: 'Temporary99!' } },
    ])
    expect(screen.getByRole('status')).toHaveTextContent(
      'A new initial password was set for Sarah Chen. They are signed out and must change it when they next sign in.',
    )
    // The password itself is said nowhere on the page afterwards.
    expect(document.body.textContent).not.toContain('Temporary99!')
  })

  it('validates the new password before sending', async () => {
    mockApi()
    await openScreen()
    const user = await openEdit('Sarah Chen')

    await user.click(dialog().getByRole('button', { name: 'Set new initial password' }))
    await user.type(dialog().getByLabelText('New initial password for Sarah Chen'), 'short')
    await user.click(dialog().getByRole('button', { name: 'Confirm new password' }))

    expect(dialog().getByText('Must be at least 8 characters')).toBeInTheDocument()
    expect(sent).toEqual([])
  })

  it('does not offer it on your own account, and points to Change password instead', async () => {
    mockApi()
    await openScreen()
    await openEdit('Ada Admin')

    expect(dialog().queryByRole('button', { name: 'Set new initial password' })).toBeNull()
    expect(dialog().getByRole('link', { name: 'Change password' })).toHaveAttribute('href', '/change-password')
  })
})

describe('the dialog itself (ui-spec §7, §9)', () => {
  it('is labelled by its heading and takes focus when it opens', async () => {
    mockApi()
    await openScreen()
    await openCreate()

    expect(screen.getByRole('dialog', { name: 'New user' })).toHaveAttribute('aria-modal', 'true')
    expect(dialog().getByLabelText(/^Name/)).toHaveFocus()
  })

  it('closes on Escape without saving, and returns focus to what opened it', async () => {
    mockApi()
    await openScreen()
    const user = await openEdit('Sarah Chen')
    await user.type(dialog().getByLabelText(/^Name/), ' edited')

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(sent).toEqual([])
    expect((await table()).getByRole('button', { name: 'Edit Sarah Chen' })).toHaveFocus()
  })

  it('still closes on Escape, and takes Tab back, when focus has fallen out of it', async () => {
    mockApi()
    await openScreen()
    const user = await openEdit('Sarah Chen')

    // What a browser does when the focused button is disabled mid-save: focus
    // lands on the page body, outside the dialog.
    ;(document.activeElement as HTMLElement).blur()
    expect(document.body).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)

    ;(document.activeElement as HTMLElement).blur()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps Tab inside the dialog in both directions', async () => {
    mockApi()
    await openScreen()
    const user = await openCreate()

    const inside = () => screen.getByRole('dialog').contains(document.activeElement)
    // More presses than there are controls, forwards and then backwards.
    for (let press = 0; press < 12; press += 1) {
      await user.tab()
      expect(inside()).toBe(true)
    }
    for (let press = 0; press < 12; press += 1) {
      await user.tab({ shift: true })
      expect(inside()).toBe(true)
    }
  })
})

describe('loading, forbidden and failed', () => {
  it('renders a safe failure with a Retry that reloads', async () => {
    let fail = true
    mockApi({
      list: () => (fail ? Response.json({ error: 'relation "User" does not exist' }, { status: 500 }) : Response.json(server)),
    })
    await openScreen()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to load the users')
    expect(alert).not.toHaveTextContent(/relation|does not exist/)

    fail = false
    const user = userEvent.setup()
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect((await table()).getByText('Sarah Chen')).toBeInTheDocument()
  })

  it('shows Forbidden with a way home, and no Retry, when the API refuses the role', async () => {
    mockApi({ list: () => Response.json({ error: 'Forbidden' }, { status: 403 }) })
    await openScreen()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/do not have permission/i)
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByRole('search')).toBeNull()
  })

  it('never requests the list for IT Staff or a Requester', async () => {
    for (const role of ['IT_STAFF', 'REQUESTER'] as const) {
      vi.restoreAllMocks()
      listQueries = []
      signedIn = authUser({ id: 9, name: 'Sarah Chen', role })
      mockApi()
      window.history.pushState({}, '', '/admin/users')
      const view = await renderApp()

      expect(await screen.findByRole('alert')).toHaveTextContent(/do not have permission/i)
      expect([role, listQueries]).toEqual([role, []])
      view.unmount()
    }
  })
})
