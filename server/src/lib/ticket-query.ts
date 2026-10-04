// BR-09..BR-12: the My Tickets query contract (api-spec.md §5).
//
// Posture, taken from the spec: every parameter here is a display preference,
// so a value that cannot be honoured falls back to its default rather than
// failing the request. A reader whose bookmarked URL has gone stale should
// still see their tickets.
//
// There is no strict parameter left to contrast that with: ownership used to
// arrive as `requesterId` and was validated hard, and since Issue #41 it comes
// from the session and never passes through here at all.

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;

export const SORTABLE_FIELDS = [
  "createdAt",
  "ticketNumber",
  "requestedPriority",
  "currentStatus",
] as const;
export type SortField = (typeof SORTABLE_FIELDS)[number];

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface TicketQuery {
  search?: string;
  categoryId?: number;
  requestedPriority?: Priority;
  sortBy: SortField;
  sortDir: "asc" | "desc";
  page: number;
  pageSize: number;
  /** True when any narrowing parameter was supplied — the client needs this
   *  to tell BR-28's Empty state from its No-Results state. */
  filtered: boolean;
}

function firstValue(raw: unknown): string | undefined {
  // Express gives an array when a param repeats (?page=1&page=2). Take the
  // first rather than letting `Number(['1','2'])` collapse to NaN.
  if (Array.isArray(raw)) return typeof raw[0] === "string" ? raw[0] : undefined;
  return typeof raw === "string" ? raw : undefined;
}

function parsePositiveInt(raw: unknown): number | undefined {
  const value = firstValue(raw);
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Clamped to at least 1 (BR-12); anything unparseable becomes page 1. */
function parsePage(raw: unknown): number {
  const value = firstValue(raw);
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Clamped into 1..50 (BR-12) rather than rejected. */
function parsePageSize(raw: unknown): number {
  const value = firstValue(raw);
  if (value === undefined || value.trim() === "") return DEFAULT_PAGE_SIZE;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.floor(n), 1), MAX_PAGE_SIZE);
}

export function parseTicketQuery(query: Record<string, unknown>): TicketQuery {
  const search = firstValue(query.search)?.trim() || undefined;
  const categoryId = parsePositiveInt(query.categoryId);

  const rawPriority = firstValue(query.requestedPriority);
  const requestedPriority = (PRIORITIES as readonly string[]).includes(
    rawPriority ?? "",
  )
    ? (rawPriority as Priority)
    : undefined;

  const rawSortBy = firstValue(query.sortBy);
  const sortBy = (SORTABLE_FIELDS as readonly string[]).includes(rawSortBy ?? "")
    ? (rawSortBy as SortField)
    : "createdAt";

  const rawSortDir = firstValue(query.sortDir);
  const sortDir = rawSortDir === "asc" ? "asc" : "desc";

  return {
    search,
    categoryId,
    requestedPriority,
    sortBy,
    sortDir,
    page: parsePage(query.page),
    pageSize: parsePageSize(query.pageSize),
    // Only narrowing parameters count. Sort and pagination change how the
    // same set is presented, so landing on page 3 of an empty account is
    // still the Empty state, not No-Results.
    filtered: Boolean(search || categoryId || requestedPriority),
  };
}

// ---------------------------------------------------------------------------
// BR-30, BR-31: the IT Staff Ticket Queue (api-spec.md §8).
//
// Same posture as My Tickets above, and the same helpers: nothing here can
// fail a request. The queue differs in what it may narrow by, not in how a
// bad value is treated.

export const QUEUE_SORTABLE_FIELDS = [
  "createdAt",
  "updatedAt",
  "ticketNumber",
  "itPriority",
  "currentStatus",
] as const;
export type QueueSortField = (typeof QUEUE_SORTABLE_FIELDS)[number];

export const IT_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type ItPriorityValue = (typeof IT_PRIORITIES)[number];

export const TICKET_STATUSES = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "CANCELLED",
] as const;
export type TicketStatusValue = (typeof TICKET_STATUSES)[number];

/** `me` stays symbolic here: the parser has no session, and resolving it is
 *  the route's job. A number is a specific user's id. */
export type OwnerFilter = "me" | "unassigned" | number;

export interface StaffQueueQuery {
  search?: string;
  status?: TicketStatusValue;
  itPriority?: ItPriorityValue;
  categoryId?: number;
  owner?: OwnerFilter;
  sortBy: QueueSortField;
  sortDir: "asc" | "desc";
  page: number;
  pageSize: number;
  /** True when any narrowing parameter survived parsing, so the client can
   *  tell an empty queue from a search that matched nothing (AC-23). */
  filtered: boolean;
}

function oneOf<T extends string>(
  allowed: readonly T[],
  raw: unknown,
): T | undefined {
  const value = firstValue(raw);
  return (allowed as readonly string[]).includes(value ?? "")
    ? (value as T)
    : undefined;
}

function parseOwner(raw: unknown): OwnerFilter | undefined {
  const value = firstValue(raw);
  if (value === "me" || value === "unassigned") return value;
  return parsePositiveInt(raw);
}

export function parseStaffQueueQuery(
  query: Record<string, unknown>,
): StaffQueueQuery {
  const search = firstValue(query.search)?.trim() || undefined;
  const status = oneOf(TICKET_STATUSES, query.status);
  const itPriority = oneOf(IT_PRIORITIES, query.itPriority);
  const categoryId = parsePositiveInt(query.categoryId);
  const owner = parseOwner(query.owner);

  return {
    search,
    status,
    itPriority,
    categoryId,
    owner,
    // BR-31: Last Updated descending is the default, because a queue is read
    // for what moved most recently.
    sortBy: oneOf(QUEUE_SORTABLE_FIELDS, query.sortBy) ?? "updatedAt",
    sortDir: firstValue(query.sortDir) === "asc" ? "asc" : "desc",
    page: parsePage(query.page),
    pageSize: parsePageSize(query.pageSize),
    // Computed from what was kept, not what was sent: `?status=BOGUS` narrows
    // nothing, so an empty result under it is the Empty state, and telling
    // staff "no Tickets match these filters" would point at a filter that
    // was never applied.
    filtered: Boolean(
      search || status || itPriority || categoryId || owner !== undefined,
    ),
  };
}
