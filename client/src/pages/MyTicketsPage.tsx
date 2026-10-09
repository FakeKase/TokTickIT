import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { fetchCategories, fetchTickets } from '../api'
import type {
  Category,
  RequestedPriority,
  StatusFilter,
  TicketListParams,
  TicketListResponse,
  TicketSortField,
  TicketStatus,
} from '../api'
import { Badge } from '../components/Badge'
import type { BadgeTone } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { StatusBadge } from '../components/TicketBadges'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Field } from '../components/Field'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { STATUS_LABEL } from '../components/ticketLabels'
import { useAuth } from '../auth/useAuth'
import './MyTicketsPage.css'

type Filters = {
  search: string
  status: StatusFilter | ''
  categoryId: string
  requestedPriority: RequestedPriority | ''
}

const NO_FILTERS: Filters = { search: '', status: '', categoryId: '', requestedPriority: '' }

const STATUSES = Object.keys(STATUS_LABEL) as TicketStatus[]
/** A status, or every active one (Lab 4 BR-22): what the dashboard's Open
 *  Tickets card links to. */
const STATUS_FILTERS: StatusFilter[] = ['ACTIVE', ...STATUSES]
const PRIORITIES: RequestedPriority[] = ['LOW', 'MEDIUM', 'HIGH']

const PRIORITY_TONE: Record<RequestedPriority, BadgeTone> = {
  LOW: 'pale',
  MEDIUM: 'warning',
  HIGH: 'danger',
}

const PRIORITY_LABEL: Record<RequestedPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
}

const SORTS: { field: TicketSortField; label: string }[] = [
  { field: 'ticketNumber', label: 'Ticket No.' },
  { field: 'createdAt', label: 'Created Date' },
  { field: 'requestedPriority', label: 'Requested Priority' },
  { field: 'currentStatus', label: 'Current Status' },
  { field: 'updatedAt', label: 'Last Updated' },
]

/** What the list is showing: the filters in force, the order and the page. */
interface View extends Filters {
  sortBy: TicketSortField
  sortDir: 'asc' | 'desc'
  page: number
}

const DEFAULT_VIEW: View = { ...NO_FILTERS, sortBy: 'createdAt', sortDir: 'desc', page: 1 }

const pick = <T extends string>(allowed: readonly T[], raw: string | null): T | '' =>
  (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : ''

/**
 * The view, read out of the address bar, as the Ticket Queue reads its own
 * (Lab 4 ui-spec.md §5).
 *
 * The URL is the state and not a copy of it, so a dashboard card can link to
 * a filtered list, and a reload or the Back button shows the list that was
 * left. Anything unrecognised falls back to its default, which is what the
 * API does with it too: a stale or hand-edited link still shows the Tickets.
 */
function readView(params: URLSearchParams): View {
  const page = Number(params.get('page'))

  return {
    search: params.get('search')?.trim() ?? '',
    status: pick(STATUS_FILTERS, params.get('status')),
    categoryId: /^[1-9]\d*$/.test(params.get('categoryId') ?? '') ? params.get('categoryId')! : '',
    requestedPriority: pick(PRIORITIES, params.get('requestedPriority')),
    sortBy:
      pick(
        SORTS.map((sort) => sort.field),
        params.get('sortBy'),
      ) || DEFAULT_VIEW.sortBy,
    sortDir: params.get('sortDir') === 'asc' ? 'asc' : 'desc',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  }
}

/** Defaults are left out, so the plain list is `/tickets`. */
function writeView(view: View): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of Object.keys(view) as (keyof View)[]) {
    if (view[key] !== DEFAULT_VIEW[key]) params.set(key, String(view[key]))
  }
  return params
}

const filtersOf = ({ search, status, categoryId, requestedPriority }: View): Filters => ({
  search,
  status,
  categoryId,
  requestedPriority,
})

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * My Tickets (ui-spec.md §6.3): toolbar, desktop table / mobile cards,
 * pagination, and BR-28's two distinct zero-result states.
 */
export function MyTicketsPage() {
  // Identity comes from the session and never leaves this component: no call
  // below carries a Requester id, because the server takes it from the cookie
  // (BR-03).
  const { user: requester } = useAuth()
  const navigate = useNavigate()

  const [params, setParams] = useSearchParams()
  const view = useMemo(() => readView(params), [params])
  const { sortBy, sortDir } = view

  const [categories, setCategories] = useState<Category[]>([])
  // `filters` is what the user has chosen in the toolbar; the URL holds what
  // the last request used. Keeping them apart stops a half-typed search from
  // firing a request. They are brought back together whenever the URL's own
  // filters change: on arrival from a dashboard card, on Back, on Clear.
  const [filters, setFilters] = useState<Filters>(() => filtersOf(view))
  const appliedKey = JSON.stringify(filtersOf(view))
  useEffect(() => {
    setFilters(JSON.parse(appliedKey) as Filters)
  }, [appliedKey])

  const [response, setResponse] = useState<TicketListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const signedInUserId = requester?.id

  /** Any change to what is being looked at goes back to page 1; only paging
   *  itself keeps the page. */
  const change = useCallback(
    (patch: Partial<View>) => {
      setParams(writeView({ ...view, page: 1, ...patch }), { replace: true })
    },
    [view, setParams],
  )

  const load = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!signedInUserId) return
      setLoading(true)
      setFailed(false)
      try {
        const request: TicketListParams = {
          search: view.search || undefined,
          status: view.status || undefined,
          categoryId: view.categoryId ? Number(view.categoryId) : undefined,
          requestedPriority: view.requestedPriority || undefined,
          sortBy: view.sortBy,
          sortDir: view.sortDir,
          page: view.page,
        }
        const loaded = await fetchTickets(request)
        if (isCurrent()) setResponse(loaded)
      } catch {
        if (!isCurrent()) return
        setFailed(true)
        setResponse(null)
      } finally {
        if (isCurrent()) setLoading(false)
      }
    },
    [signedInUserId, view],
  )

  useEffect(() => {
    // Sorting applies as it changes, so two requests can be out at once. Only
    // the newest may land.
    let current = true
    void load(() => current)
    return () => {
      current = false
    }
  }, [load])

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setCategories([]))
  }, [])

  function applyFilters(event: React.FormEvent) {
    event.preventDefault()
    change({ ...filters, search: filters.search.trim() })
  }

  function clearFilters() {
    // Emptied here as well as through the URL: something chosen but never
    // applied is not in the URL, so nothing there would change to clear it.
    setFilters(NO_FILTERS)
    change(NO_FILTERS)
  }

  function toggleSort(field: TicketSortField) {
    change(
      sortBy === field
        ? { sortDir: sortDir === 'asc' ? 'desc' : 'asc' }
        : { sortBy: field, sortDir: 'desc' },
    )
  }

  const sortHeader = (field: TicketSortField) => (
    <th
      key={field}
      scope="col"
      aria-sort={sortBy === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" onClick={() => toggleSort(field)}>
        {SORTS.find((sort) => sort.field === field)!.label}
        {sortBy === field && <span aria-hidden="true">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
      </button>
    </th>
  )

  if (!requester) return null

  const pagination = response?.pagination
  const rows = response?.data ?? []
  const isEmptyAccount = Boolean(response) && rows.length === 0 && !response!.filtered
  const isNoResults = Boolean(response) && rows.length === 0 && response!.filtered

  return (
    <div className="ttk-my-tickets">
      <div className="ttk-my-tickets__head">
        <div className="ttk-my-tickets__title">
          <h2>My Tickets</h2>
          {/* The number a dashboard card showed, so the two can be compared
              at a glance (Lab 4 AC-37). */}
          {!loading && pagination && pagination.totalItems > 0 && (
            <p className="ttk-my-tickets__count" data-testid="list-total">
              {pagination.totalItems} {pagination.totalItems === 1 ? 'Ticket' : 'Tickets'}
            </p>
          )}
        </div>
        <Button onClick={() => navigate('/tickets/new')}>Create Ticket</Button>
      </div>

      {/* The toolbar is hidden in the Empty state: filtering nothing implies
          data exists somewhere, which is exactly the confusion BR-28 warns
          about. */}
      {!isEmptyAccount && (
        <form className="ttk-my-tickets__toolbar" onSubmit={applyFilters} role="search">
          <Field id="ticket-search" label="Search" className="ttk-my-tickets__search">
            {(attrs) => (
              <input
                {...attrs}
                type="search"
                placeholder="Ticket Number or Summary"
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              />
            )}
          </Field>

          <Field id="filter-status" label="Status">
            {(attrs) => (
              <select
                {...attrs}
                value={filters.status}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, status: e.target.value as StatusFilter | '' }))
                }
              >
                <option value="">All Statuses</option>
                <option value="ACTIVE">Active</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field id="filter-category" label="Category">
            {(attrs) => (
              <select
                {...attrs}
                value={filters.categoryId}
                onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value }))}
              >
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field id="filter-priority" label="Requested Priority">
            {(attrs) => (
              <select
                {...attrs}
                value={filters.requestedPriority}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    requestedPriority: e.target.value as RequestedPriority | '',
                  }))
                }
              >
                <option value="">All Priorities</option>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>
            )}
          </Field>

          {/* Mobile only: the table header carries the sort buttons, and the
              table is hidden under 768px, so FR-07 would otherwise be
              unreachable on a phone. Sorting applies immediately here, the
              same as clicking a column header — it is not a pending filter. */}
          <div className="ttk-my-tickets__sort">
            <Field id="sort-by" label="Sort by">
              {(attrs) => (
                <select
                  {...attrs}
                  value={sortBy}
                  onChange={(e) => change({ sortBy: e.target.value as TicketSortField })}
                >
                  {SORTS.map((column) => (
                    <option key={column.field} value={column.field}>
                      {column.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Button
              variant="secondary"
              onClick={() => change({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' })}
            >
              {sortDir === 'asc' ? 'Ascending' : 'Descending'}
            </Button>
          </div>

          <div className="ttk-my-tickets__toolbar-actions">
            <Button type="submit">Apply</Button>
            <Button variant="secondary" onClick={clearFilters}>
              Clear Filters
            </Button>
          </div>
        </form>
      )}

      {loading && <LoadingSpinner label="Loading your Tickets…" />}

      {!loading && failed && (
        <ErrorState
          title="Unable to load your Tickets"
          message="The Ticket list could not be loaded. Check that the TokTickIT API is running, then try again."
          onRetry={() => void load()}
        />
      )}

      {!loading && !failed && isEmptyAccount && (
        <EmptyState
          title="You haven't created any tickets yet"
          message="When you submit a ticket it will appear here, along with its official Ticket Number."
          action={<Button onClick={() => navigate('/tickets/new')}>Create Ticket</Button>}
        />
      )}

      {/* Distinct copy and a distinct action from the Empty state above — the
          user has tickets, just not matching these filters (BR-28). */}
      {!loading && !failed && isNoResults && (
        <EmptyState
          title="No tickets match your filters"
          message="Try a different search term, or clear the filters to see all of your tickets."
          action={
            <Button variant="secondary" onClick={clearFilters}>
              Clear Filters
            </Button>
          }
        />
      )}

      {!loading && !failed && rows.length > 0 && (
        <>
          {/* Desktop: table. Mobile: the same rows as cards (ui-spec.md §6.3). */}
          <table className="ttk-my-tickets__table">
            <caption className="ttk-visually-hidden">
              Your Tickets, sorted by {sortBy} {sortDir === 'asc' ? 'ascending' : 'descending'}
            </caption>
            <thead>
              <tr>
                {sortHeader('ticketNumber')}
                {sortHeader('createdAt')}
                {sortHeader('requestedPriority')}
                {sortHeader('currentStatus')}
                <th scope="col">Summary</th>
                <th scope="col">Category</th>
                {sortHeader('updatedAt')}
              </tr>
            </thead>
            <tbody>
              {rows.map((ticket) => (
                <tr key={ticket.id}>
                  <td>
                    <Link to={`/tickets/${ticket.id}`}>{ticket.ticketNumber}</Link>
                  </td>
                  <td>{formatDate(ticket.createdAt)}</td>
                  <td>
                    <Badge tone={PRIORITY_TONE[ticket.requestedPriority]}>
                      {PRIORITY_LABEL[ticket.requestedPriority]}
                    </Badge>
                  </td>
                  <td>
                    <StatusBadge status={ticket.currentStatus} />
                  </td>
                  <td>{ticket.summary}</td>
                  <td>{ticket.categoryName}</td>
                  <td>{formatDate(ticket.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="ttk-my-tickets__cards">
            {rows.map((ticket) => (
              <li key={ticket.id}>
                <Card>
                  <Link to={`/tickets/${ticket.id}`} className="ttk-my-tickets__card-title">
                    {ticket.ticketNumber} — {ticket.summary}
                  </Link>
                  <p className="ttk-my-tickets__card-badges">
                    <Badge tone={PRIORITY_TONE[ticket.requestedPriority]}>
                      {PRIORITY_LABEL[ticket.requestedPriority]}
                    </Badge>{' '}
                    <StatusBadge status={ticket.currentStatus} />
                  </p>
                  <p className="ttk-my-tickets__card-meta">
                    {ticket.categoryName} · Created {formatDate(ticket.createdAt)}
                  </p>
                </Card>
              </li>
            ))}
          </ul>

          {pagination && pagination.totalPages > 1 && (
            <nav className="ttk-my-tickets__pagination" aria-label="Ticket list pages">
              <Button
                variant="secondary"
                onClick={() => change({ page: Math.max(1, pagination.page - 1) })}
                disabled={pagination.page <= 1}
              >
                Previous
              </Button>
              <span>
                {`Showing ${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(
                  pagination.page * pagination.pageSize,
                  pagination.totalItems,
                )} of ${pagination.totalItems}`}
              </span>
              <Button
                variant="secondary"
                onClick={() => change({ page: pagination.page + 1 })}
                disabled={pagination.page >= pagination.totalPages}
              >
                Next
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
