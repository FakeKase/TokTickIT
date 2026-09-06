// BR-09..BR-12: the My Tickets query contract (api-spec.md §5).
//
// Posture, taken from the spec: `requesterId` is the only strict parameter —
// everything else is a display preference, so a value that cannot be honoured
// falls back to its default rather than failing the request. A reader whose
// bookmarked URL has gone stale should still see their tickets.

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
