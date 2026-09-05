import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchCategories, fetchTickets } from '../api'
import type {
  Category,
  RequestedPriority,
  TicketListParams,
  TicketListResponse,
} from '../api'
import { Badge } from '../components/Badge'
import type { BadgeTone } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Field } from '../components/Field'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useSelectedRequester } from '../requester/useSelectedRequester'
import './MyTicketsPage.css'

type Filters = {
  search: string
  categoryId: string
  requestedPriority: RequestedPriority | ''
}

const NO_FILTERS: Filters = { search: '', categoryId: '', requestedPriority: '' }

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

const SORT_COLUMNS = [
  { field: 'ticketNumber', label: 'Ticket No.' },
  { field: 'createdAt', label: 'Created Date' },
  { field: 'requestedPriority', label: 'Requested Priority' },
  { field: 'currentStatus', label: 'Current Status' },
] as const

type SortField = TicketListParams['sortBy']

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function statusLabel(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase()
}

/**
 * My Tickets (ui-spec.md §6.3): toolbar, desktop table / mobile cards,
 * pagination, and BR-28's two distinct zero-result states.
 */
export function MyTicketsPage() {
  const { requester } = useSelectedRequester()
  const navigate = useNavigate()

  const [categories, setCategories] = useState<Category[]>([])
  // `filters` is what the user has typed; `applied` is what the last request
  // used. Keeping them apart stops a half-typed search from firing a request
  // and lets Clear Filters reset both in one go.
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [applied, setApplied] = useState<Filters>(NO_FILTERS)
  const [sortBy, setSortBy] = useState<SortField>('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  const [response, setResponse] = useState<TicketListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const requesterId = requester?.id

  const load = useCallback(async () => {
    if (!requesterId) return
    setLoading(true)
    setFailed(false)
    try {
      setResponse(
        await fetchTickets(requesterId, {
          search: applied.search || undefined,
          categoryId: applied.categoryId ? Number(applied.categoryId) : undefined,
          requestedPriority: applied.requestedPriority || undefined,
          sortBy,
          sortDir,
          page,
        }),
      )
    } catch {
      setFailed(true)
      setResponse(null)
    } finally {
      setLoading(false)
    }
  }, [requesterId, applied, sortBy, sortDir, page])

  useEffect(() => {
    void load()
  }, [load])

  // AC-12/BR-05: switching Requester must not leave the previous one's page
  // number or filters in place.
  useEffect(() => {
    setFilters(NO_FILTERS)
    setApplied(NO_FILTERS)
    setPage(1)
  }, [requesterId])

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setCategories([]))
  }, [])

  function applyFilters(event: React.FormEvent) {
    event.preventDefault()
    setApplied(filters)
    setPage(1)
  }

  function clearFilters() {
    setFilters(NO_FILTERS)
    setApplied(NO_FILTERS)
    setPage(1)
  }

  function toggleSort(field: NonNullable<SortField>) {
    if (sortBy === field) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
    setPage(1)
  }

  if (!requester) return null

  const pagination = response?.pagination
  const rows = response?.data ?? []
  const isEmptyAccount = Boolean(response) && rows.length === 0 && !response!.filtered
  const isNoResults = Boolean(response) && rows.length === 0 && response!.filtered

  return (
    <div className="ttk-my-tickets">
      <div className="ttk-my-tickets__head">
        <h2>My Tickets</h2>
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
                {SORT_COLUMNS.map((column) => (
                  <th
                    key={column.field}
                    scope="col"
                    aria-sort={
                      sortBy === column.field
                        ? sortDir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button type="button" onClick={() => toggleSort(column.field)}>
                      {column.label}
                      {sortBy === column.field && (
                        <span aria-hidden="true">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>
                      )}
                    </button>
                  </th>
                ))}
                <th scope="col">Summary</th>
                <th scope="col">Category</th>
                <th scope="col">Last Updated</th>
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
                    <Badge tone="pale">{statusLabel(ticket.currentStatus)}</Badge>
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
                    <Badge tone="pale">{statusLabel(ticket.currentStatus)}</Badge>
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
                onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                onClick={() => setPage((p) => p + 1)}
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
