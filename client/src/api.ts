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
let onUnauthorized: (() => void) | null = null

/**
 * Registers what happens when the API says the session is gone.
 *
 * AuthProvider owns the handler; this module only needs somewhere to report to.
 * Without it, a session that expires mid-use leaves every screen showing its
 * own failure state - safe, but it reads as "the server is broken" rather than
 * "you were signed out", and nothing moves the person to Login.
 */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: 'include' })

  // The auth endpoints are excluded on purpose: a 401 from `login` is a wrong
  // password and a 401 from `me` is an ordinary anonymous visitor. Neither is a
  // session that went away, and treating them as one would clear state the
  // caller is already handling.
  if (response.status === 401 && !path.startsWith('/api/auth/')) {
    onUnauthorized?.()
  }

  return response
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

/** Set by IT Staff, independently of what the Requester asked for (BR-21). */
export type ItPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

/** Every value a Ticket's status can hold (specification.md §5.2). */
export type TicketStatus =
  | 'NEW'
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_FOR_REQUESTER'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED'
  | 'CANCELLED'

export interface Ticket {
  id: number
  ticketNumber: string
  requesterId: number
  categoryId: number
  relatedSystemId: number
  summary: string
  description: string
  requestedPriority: RequestedPriority
  currentStatus: TicketStatus
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
export async function uploadAttachment(ticketId: number, file: File): Promise<Attachment> {
  const body = new FormData()
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
  currentStatus: TicketStatus
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
  params: TicketListParams = {},
): Promise<TicketListResponse> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }

  const search = query.toString()
  const response = await apiFetch(search ? `/api/tickets?${search}` : '/api/tickets')

  if (!response.ok) {
    throw await readError(response, 'Unable to load your Tickets')
  }

  return (await response.json()) as TicketListResponse
}

export interface StaffQueueItem {
  id: number
  ticketNumber: string
  summary: string
  category: { id: number; name: string }
  requester: { id: number; name: string }
  /** `null` for an unassigned Ticket. */
  owner: { id: number; name: string } | null
  requestedPriority: RequestedPriority
  itPriority: ItPriority
  currentStatus: TicketStatus
  requesterResolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface StaffQueueResponse {
  data: StaffQueueItem[]
  pagination: {
    /** The page actually served, which is not always the one asked for: a
     *  page past the end is clamped to the last real one (AC-26). */
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
  }
  /** True when a narrowing parameter was applied — separates the Empty state
   *  from No-Results (AC-23). */
  filtered: boolean
}

export type StaffQueueSortField =
  | 'createdAt'
  | 'updatedAt'
  | 'ticketNumber'
  | 'itPriority'
  | 'currentStatus'

export interface StaffQueueParams {
  search?: string
  status?: TicketStatus
  itPriority?: ItPriority
  categoryId?: number
  owner?: 'me' | 'unassigned'
  sortBy?: StaffQueueSortField
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/**
 * The IT Staff Ticket Queue: every Requester's Tickets (api-spec.md §8).
 *
 * Throws ApiError with the status, so the screen can tell "you may not see
 * this" (403) from "it did not load" and not offer a Retry for the former.
 */
export async function fetchStaffTickets(
  params: StaffQueueParams = {},
): Promise<StaffQueueResponse> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }

  const search = query.toString()
  const response = await apiFetch(
    search ? `/api/staff/tickets?${search}` : '/api/staff/tickets',
  )

  if (!response.ok) {
    throw await readError(response, 'Unable to load the Ticket Queue')
  }

  return (await response.json()) as StaffQueueResponse
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
  requesterResolvedAt?: string | null
  requester: { id: number; name: string }
  category: { id: number; name: string }
  relatedSystem: { id: number; name: string }
  summary: string
  description: string
  requestedPriority: RequestedPriority
  currentStatus: TicketStatus
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
export async function fetchTicket(ticketId: number): Promise<TicketDetail> {
  const response = await apiFetch(`/api/tickets/${ticketId}`)

  if (!response.ok) {
    throw await readError(response, 'Unable to load the Ticket')
  }

  return (await response.json()) as TicketDetail
}

export type CommentVisibility = 'PUBLIC' | 'INTERNAL'

/** One entry on a Ticket's thread (api-spec.md §6). A Requester only ever
 *  receives `PUBLIC` entries; an internal note is filtered out of the
 *  collection server-side, not hidden here (BR-04). */
export interface TicketComment {
  id: number
  ticketId: number
  visibility: CommentVisibility
  body: string
  author: { id: number; name: string; role: Role }
  createdAt: string
}

export async function fetchComments(ticketId: number): Promise<TicketComment[]> {
  const response = await apiFetch(`/api/tickets/${ticketId}/comments`)

  if (!response.ok) {
    throw await readError(response, 'Unable to load the comments')
  }

  return (await response.json()) as TicketComment[]
}

/**
 * Posts a Public Comment or an Internal Note (api-spec.md §6).
 *
 * The Requester's composer passes no `visibility` and the field is left out of
 * the request, so the server's default of PUBLIC applies and nothing on that
 * screen can ask for anything else. A staff composer always names its own,
 * because the two staff composers differ in nothing but this value: leaving it
 * to a default is how an internal note would end up public.
 */
export async function postComment(
  ticketId: number,
  body: string,
  visibility?: CommentVisibility,
): Promise<TicketComment> {
  const response = await apiFetch(`/api/tickets/${ticketId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(visibility ? { body, visibility } : { body }),
  })

  if (!response.ok) {
    throw await readError(response, 'Unable to post the comment')
  }

  return (await response.json()) as TicketComment
}

/** One move the Ticket may make from where it is (specification.md §5.2). */
export interface StatusTransition {
  to: TicketStatus
  /** The move also needs a Ticket Owner (BR-23). */
  requiresOwner: boolean
}

/** A Ticket as IT Staff see it (api-spec.md §9). */
export interface StaffTicketDetail extends StaffQueueItem {
  description: string
  relatedSystem: { id: number; name: string }
  attachments: TicketAttachment[]
  /** Where this Ticket may go next, read from the server's own matrix. The
   *  client keeps no copy of that matrix to fall out of step with it. */
  transitions: StatusTransition[]
  /** The Ticket's status is one that must keep its owner (BR-23), so it
   *  cannot be unassigned, only handed to someone else. */
  ownerRequired: boolean
}

export interface AssignableUser {
  id: number
  name: string
  role: Role
}

export async function fetchStaffTicket(id: number): Promise<StaffTicketDetail> {
  const response = await apiFetch(`/api/staff/tickets/${id}`)

  if (!response.ok) {
    throw await readError(response, 'Unable to load the Ticket')
  }

  return (await response.json()) as StaffTicketDetail
}

/** Active IT Staff and Administrators: who a Ticket may be given to (§13). */
export async function fetchAssignableUsers(): Promise<AssignableUser[]> {
  const response = await apiFetch('/api/staff/assignable-users')

  if (!response.ok) {
    throw await readError(response, 'Unable to load the assignable users')
  }

  return (await response.json()) as AssignableUser[]
}

/** One PATCH to a staff Ticket. Each returns the whole updated Ticket, so the
 *  screen replaces what it holds rather than patching a field and hoping the
 *  rest still matches. */
async function patchStaffTicket(
  id: number,
  what: 'owner' | 'it-priority' | 'status',
  body: Record<string, unknown>,
  fallback: string,
): Promise<StaffTicketDetail> {
  const response = await apiFetch(`/api/staff/tickets/${id}/${what}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw await readError(response, fallback)
  }

  return (await response.json()) as StaffTicketDetail
}

/** Claim, reassign, or (with `null`) unassign (api-spec.md §10). */
export const setTicketOwner = (id: number, ownerId: number | null) =>
  patchStaffTicket(id, 'owner', { ownerId }, 'Unable to change the Ticket Owner')

/** api-spec.md §11. Requested Priority is not touched (BR-21). */
export const setItPriority = (id: number, itPriority: ItPriority) =>
  patchStaffTicket(id, 'it-priority', { itPriority }, 'Unable to change the IT Priority')

/** api-spec.md §12. Only the target is sent; the server judges the move from
 *  the status it holds, not from one this screen believes. */
export const setTicketStatus = (id: number, currentStatus: TicketStatus) =>
  patchStaffTicket(id, 'status', { currentStatus }, 'Unable to change the status')

export interface ResolvedSignal {
  id: number
  currentStatus: TicketStatus
  requesterResolvedAt: string
}

/** api-spec.md §7. Records the signal and posts the comment that carries it;
 *  the Ticket's status is untouched (BR-24). */
export async function markProblemResolved(ticketId: number): Promise<ResolvedSignal> {
  const response = await apiFetch(`/api/tickets/${ticketId}/requester-resolved`, {
    method: 'POST',
  })

  if (!response.ok) {
    throw await readError(response, 'Unable to record that the problem appears resolved')
  }

  return (await response.json()) as ResolvedSignal
}

/**
 * The download URL for an active Attachment (api-spec.md §9).
 *
 * A URL for an `<a href>`, not for `fetch`: the browser attaches the session
 * cookie itself on a same-site navigation, which is why this is the one place
 * that does not go through `apiFetch`.
 */
export function attachmentDownloadUrl(attachmentId: number): string {
  return `${API_URL}/api/attachments/${attachmentId}/download`
}

/** Soft-removes an owned Attachment (api-spec.md §10, BR-23/BR-25). */
export async function removeAttachment(
  attachmentId: number,
  reason: string,
): Promise<TicketAttachment> {
  const response = await apiFetch(`/api/attachments/${attachmentId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })

  if (!response.ok) {
    throw await readError(response, 'Unable to remove the Attachment')
  }

  return (await response.json()) as TicketAttachment
}
