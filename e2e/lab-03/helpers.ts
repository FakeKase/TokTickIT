import { expect } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { API, DEV_PASSWORD } from '../lab-02/helpers'

export {
  API,
  DEV_PASSWORD,
  FIXTURE_MARKER,
  VIEWPORTS,
  createTicket,
  expectNoHorizontalScroll,
  firstRequester,
} from '../lab-02/helpers'

export const shot = (screen: string, name: string) =>
  `artifacts/lab-03/screenshots/${screen}/${name}.png`

/** One seeded account per role, by the addresses the README documents. */
export const ACCOUNTS = {
  requester: { email: 'peter.parker@toktickit.test', name: 'Peter Parker', home: '/tickets' },
  staff: { email: 'sarah.chen@toktickit.test', name: 'Sarah Chen', home: '/staff/tickets' },
  colleague: { email: 'marcus.reed@toktickit.test', name: 'Marcus Reed', home: '/staff/tickets' },
  admin: { email: 'alex.morgan@toktickit.test', name: 'Alex Morgan', home: '/admin/users' },
} as const

export type Role = keyof typeof ACCOUNTS

/**
 * Every user this suite creates has an address in this domain, so the teardown
 * can find them. server/src/scripts/e2e-cleanup.ts filters on the same string,
 * and cleanup-contract.spec.ts asserts the two still match.
 */
export const FIXTURE_USER_DOMAIN = '@e2e.toktickit.test'

let userCursor = 0
/** A fresh address for a user the suite is about to create. */
export const fixtureEmail = (label: string) =>
  `${label}.${Date.now()}.${userCursor++}${FIXTURE_USER_DOMAIN}`

/**
 * Puts the browser in the signed-in state for a role, through the API.
 *
 * For specs where signing in is not what is being tested. The session is the
 * same one the form would produce; `signInThroughForm` is for the specs that
 * are about the form.
 */
export async function loginAs(page: Page, role: Role) {
  const response = await page.request.post(`${API}/api/auth/login`, {
    data: { email: ACCOUNTS[role].email, password: DEV_PASSWORD },
  })
  expect(
    response.ok(),
    `could not sign in as ${ACCOUNTS[role].email} - is the database seeded?`,
  ).toBe(true)
}

/** Fills in and submits the Login screen. Says nothing about what follows. */
export async function signInThroughForm(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel(/^Password/).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login$/)
}

/** The session cookie for an account, for a request made outside any page. */
export async function cookieFor(
  request: APIRequestContext,
  email: string,
  password: string = DEV_PASSWORD,
): Promise<string> {
  const response = await request.post(`${API}/api/auth/login`, { data: { email, password } })
  expect(response.ok(), `could not sign in as ${email}`).toBe(true)
  return (response.headers()['set-cookie'] ?? '').split(';')[0]
}

/**
 * A request context of its own, signed in as one account, or as nobody when
 * no email is given.
 *
 * The shared `request` fixture keeps a cookie jar: sign three accounts in
 * through it and a later call with no Cookie header still carries the last
 * one. For a test whose whole point is which identity was refused, each
 * identity has to have a jar to itself.
 */
export async function sessionAs(
  playwright: { request: { newContext: (options?: object) => Promise<APIRequestContext> } },
  email?: string,
  password: string = DEV_PASSWORD,
): Promise<APIRequestContext> {
  const context = await playwright.request.newContext({ baseURL: API })
  if (email) {
    const response = await context.post('/api/auth/login', { data: { email, password } })
    expect(response.ok(), `could not sign in as ${email}`).toBe(true)
  }
  return context
}

export interface CreatedUser {
  id: number
  name: string
  email: string
  password: string
}

/** Creates a user as the seeded Administrator, the way User Management does. */
export async function createUser(
  request: APIRequestContext,
  options: { name: string; role: 'REQUESTER' | 'IT_STAFF' | 'ADMINISTRATOR'; label: string },
): Promise<CreatedUser> {
  const password = 'Initial123!'
  const email = fixtureEmail(options.label)
  const response = await request.post(`${API}/api/users`, {
    headers: { Cookie: await cookieFor(request, ACCOUNTS.admin.email) },
    data: { name: options.name, email, role: options.role, initialPassword: password },
  })
  expect(response.status(), await response.text()).toBe(201)
  const { id } = (await response.json()) as { id: number }
  return { id, name: options.name, email, password }
}

/** Makes the user past their first-login gate, so a spec can use them freely. */
export async function settlePassword(request: APIRequestContext, user: CreatedUser, next: string) {
  const response = await request.post(`${API}/api/auth/change-password`, {
    headers: { Cookie: await cookieFor(request, user.email, user.password) },
    data: { currentPassword: user.password, newPassword: next, confirmPassword: next },
  })
  expect(response.status(), await response.text()).toBe(200)
}
