// Base URL of the TokTickIT API. Falls back to the local dev port so the app
// still runs when client/.env has not been created.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

/**
 * Every call goes through here so that `credentials: 'include'` cannot be
 * forgotten on a new endpoint.
 *
 * Without it the browser sends no cookie to a different origin — the API is on
 * :3001 and the client on :5173 — and every authenticated request would be
 * answered 401 while looking perfectly correct in the network tab. It is also
 * why the server sets an explicit CORS origin: a wildcard is refused once
 * credentials are in play.
 */
function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_URL}${path}`, { ...init, credentials: 'include' })
}

export interface HealthResponse {
  status: string
  service: string
}

export interface Category {
  id: number
  name: string
  description: string
}

/**
 * A Development Requester as returned by `GET /api/requesters` (api-spec.md §1).
 * Lab 2 testing scaffolding only — this is not an authenticated identity
 * (BR-03/BR-29), which is why it carries no credential or role information.
 */
export interface Requester {
  id: number
  name: string
  email: string
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await apiFetch(`/api/health`)

  if (!response.ok) {
    throw new Error(`TokTickIT API responded with ${response.status}`)
  }

  return (await response.json()) as HealthResponse
}

export async function fetchCategories(): Promise<Category[]> {
  const response = await apiFetch(`/api/categories`)

  if (!response.ok) {
    throw new Error(`TokTickIT API responded with ${response.status}`)
  }

  return (await response.json()) as Category[]
}

export interface RelatedSystem {
  id: number
  name: string
}

export type RequestedPriority = 'LOW' | 'MEDIUM' | 'HIGH'

export interface Ticket {
  id: number
  ticketNumber: string
  requesterId: number
  categoryId: number
  relatedSystemId: number
  summary: string
  description: string
  requestedPriority: RequestedPriority
  currentStatus: string
  createdAt: string
}

export interface Attachment {
  id: number
  ticketId: number
  originalFilename: string
  mimeType: string
  sizeBytes: number
  isRemoved: boolean
  createdAt: string
}

export interface CreateTicketInput {
  requesterId: number
  categoryId: number
  relatedSystemId: number
  requestedPriority: RequestedPriority
  summary: string
  description: string
}

/**
 * A failed API call, carrying the server's per-field messages when it sent
 * any. Create Ticket renders those under the matching control rather than
 * only in the banner, so a rule the client missed still lands on the field
 * it belongs to (BR-16).
 */
export class ApiError extends Error {
  /**
   * The HTTP status that produced this error. Callers branch on it rather
   * than on `message`: the wording is presentation and can change, whereas
   * the status is the contract. A 404 in particular means something specific
   * on ownership-scoped routes (BR-08) and must not be retried.
   */
  readonly status: number
  readonly fields: Record<string, string>

  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fields = fields
  }
}

async function readError(response: Response, fallback: string): Promise<ApiError> {
  try {
    const body = (await response.json()) as {
      error?: string
      fields?: Record<string, string>
    }
    return new ApiError(response.status, body.error ?? fallback, body.fields ?? {})
  } catch {
    // A non-JSON body (proxy error page, empty 502) must not mask the failure,
    // and the status is still meaningful even when the body is not.
    return new ApiError(response.status, fallback)
  }
}


/** One of the three Lab 3 roles (specification.md §5.1). */
export type Role = 'REQUESTER' | 'IT_STAFF' | 'ADMINISTRATOR'

/** The authenticated user, as every auth endpoint returns them. Deliberately
 *  the same shape everywhere, so no screen has to special-case where it came
 *  from. Never carries a password hash — see api-spec.md "Conventions". */
export interface AuthenticatedUser {
  id: number
  name: string
  email: string
  role: Role
  isActive: boolean
  mustChangePassword: boolean
  createdAt: string
}

/** api-spec.md §1. Throws ApiError(401) for a wrong password, an unknown
 *  address, and an inactive account alike — the caller cannot tell them apart,
 *  which is the point (BR-08). */
export async function login(email: string, password: string): Promise<AuthenticatedUser> {
  const response = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    throw await readError(response, 'Unable to sign in')
  }

  return ((await response.json()) as { user: AuthenticatedUser }).user
}

/** api-spec.md §2. Idempotent server-side, so a failure here is a network
 *  problem, never "you were not signed in". */
export async function logout(): Promise<void> {
  const response = await apiFetch('/api/auth/logout', { method: 'POST' })

  if (!response.ok) {
    throw await readError(response, 'Unable to sign out')
  }
}

/** api-spec.md §3. The only way this code can learn who is signed in: the
 *  session cookie is httpOnly and unreadable from JavaScript by design. */
export async function fetchCurrentUser(): Promise<AuthenticatedUser> {
  const response = await apiFetch('/api/auth/me')

  if (!response.ok) {
    throw await readError(response, 'Unable to read the current session')
  }

  return ((await response.json()) as { user: AuthenticatedUser }).user
}

/** api-spec.md §4. On success the server rotates the session, so the cookie
 *  this browser holds afterwards is a different one (BR-41). */
export async function changePassword(input: {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}): Promise<AuthenticatedUser> {
  const response = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw await readError(response, 'Unable to change the password')
  }

  return ((await response.json()) as { user: AuthenticatedUser }).user
}

/** Active Development Requesters for the selector screen (BR-04). */
export async function fetchRequesters(): Promise<Requester[]> {
  const response = await apiFetch(`/api/requesters`)

  if (!response.ok) {
    throw new Error(`TokTickIT API responded with ${response.status}`)
  }

  return (await response.json()) as Requester[]
}

/** Active Related Systems for the classification row (api-spec.md §3). */
export async function fetchRelatedSystems(): Promise<RelatedSystem[]> {
  const response = await apiFetch(`/api/related-systems`)

  if (!response.ok) {
    throw new Error(`TokTickIT API responded with ${response.status}`)
  }

  return (await response.json()) as RelatedSystem[]
}

/** Creates one Ticket for the selected Requester (api-spec.md §4). */
export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const response = await apiFetch(`/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw await readError(response, 'Unable to create the Ticket')
  }

  return (await response.json()) as Ticket
}

/**
 * Uploads one Attachment to an existing Ticket (api-spec.md §7).
 *
 * No Content-Type header is set on purpose: the browser has to add the
 * multipart boundary itself, and setting it manually breaks the upload.
 */
export async function uploadAttachment(
  ticketId: number,
  requesterId: number,
  file: File,
): Promise<Attachment> {
  const body = new FormData()
  body.append('requesterId', String(requesterId))
  body.append('file', file)

  const response = await apiFetch(`/api/tickets/${ticketId}/attachments`, {
    method: 'POST',
    body,
  })

  if (!response.ok) {
    throw await readError(response, `Unable to upload ${file.name}`)
  }

  return (await response.json()) as Attachment
}

export interface TicketListItem {
  id: number
  ticketNumber: string
  summary: string
  categoryName: string
  requestedPriority: RequestedPriority
  currentStatus: string
  createdAt: string
  updatedAt: string
}

export interface TicketListResponse {
  data: TicketListItem[]
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
  }
  /** True when a narrowing parameter was supplied — distinguishes BR-28's
   *  Empty state from No-Results. */
  filtered: boolean
}

export interface TicketListParams {
  search?: string
  categoryId?: number
  requestedPriority?: RequestedPriority
  sortBy?: 'createdAt' | 'ticketNumber' | 'requestedPriority' | 'currentStatus'
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/**
 * The selected Requester's own Tickets (api-spec.md §5).
 *
 * Unset params are omitted rather than sent empty, so the server sees the
 * same request the user would get from a clean load.
 */
export async function fetchTickets(
  requesterId: number,
  params: TicketListParams = {},
): Promise<TicketListResponse> {
  const query = new URLSearchParams({ requesterId: String(requesterId) })
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }

  const response = await apiFetch(`/api/tickets?${query.toString()}`)

  if (!response.ok) {
    throw await readError(response, 'Unable to load your Tickets')
  }

  return (await response.json()) as TicketListResponse
}

export interface TicketAttachment {
  id: number
  originalFilename: string
  mimeType: string
  sizeBytes: number
  isRemoved: boolean
  removedAt: string | null
  removedReason: string | null
  createdAt: string
}

export interface TicketDetail {
  id: number
  ticketNumber: string
  requester: { id: number; name: string }
  category: { id: number; name: string }
  relatedSystem: { id: number; name: string }
  summary: string
  description: string
  requestedPriority: RequestedPriority
  currentStatus: string
  createdAt: string
  updatedAt: string
  attachments: TicketAttachment[]
}

/**
 * One owned Ticket in full (api-spec.md §6).
 *
 * A Ticket owned by someone else answers 404, identically to one that does
 * not exist (BR-08) — so callers must not treat "not found" as "no access".
 */
export async function fetchTicket(
  ticketId: number,
  requesterId: number,
): Promise<TicketDetail> {
  const response = await apiFetch(
    `/api/tickets/${ticketId}?requesterId=${requesterId}`,
  )

  if (!response.ok) {
    throw await readError(response, 'Unable to load the Ticket')
  }

  return (await response.json()) as TicketDetail
}

/** The download URL for an active Attachment (api-spec.md §9).
 *
 *  Built here rather than in a component so the requesterId seam stays in one
 *  place — a plain <a href> would otherwise bypass it. */
/** A URL for an `<a href>`, not for fetch: the browser attaches the session
 *  cookie itself on a same-site navigation, which is why this is the one place
 *  that does not go through `apiFetch`. */
export function attachmentDownloadUrl(attachmentId: number, requesterId: number): string {
  return `${API_URL}/api/attachments/${attachmentId}/download?requesterId=${requesterId}`
}

/** Soft-removes an owned Attachment (api-spec.md §10, BR-23/BR-25). */
export async function removeAttachment(
  attachmentId: number,
  requesterId: number,
  reason: string,
): Promise<TicketAttachment> {
  const response = await apiFetch(`/api/attachments/${attachmentId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requesterId, reason }),
  })

  if (!response.ok) {
    throw await readError(response, 'Unable to remove the Attachment')
  }

  return (await response.json()) as TicketAttachment
}
