import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ApiError, fetchCategories, fetchStaffTickets } from '../api'
import type {
  Category,
  ItPriority,
  StaffQueueItem,
  StaffQueueParams,
  StaffQueueResponse,
  StaffQueueSortField,
  TicketStatus,
} from '../api'
import { landingPathFor } from '../auth/landing'
import { useAuth } from '../auth/useAuth'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Field } from '../components/Field'
import { ItPriorityBadge, RequestedPriorityBadge, StatusBadge } from '../components/TicketBadges'
import { IT_PRIORITY_LABEL, STATUS_LABEL } from '../components/ticketLabels'
import { formatAbsolute, formatRelative } from './relativeTime'
import './StaffTicketQueuePage.css'

const STATUSES = Object.keys(STATUS_LABEL) as TicketStatus[]
const IT_PRIORITIES = Object.keys(IT_PRIORITY_LABEL) as ItPriority[]

/** Every key the API sorts by. Created Date has no column (ui-spec.md §4), so
 *  this list — not the table header — is where all five are offered. */
const SORTS: { field: StaffQueueSortField; label: string }[] = [
  { field: 'updatedAt', label: 'Last Updated' },
  { field: 'createdAt', label: 'Created Date' },
  { field: 'ticketNumber', label: 'Ticket Number' },
  { field: 'itPriority', label: 'IT Priority' },
  { field: 'currentStatus', label: 'Status' },
]

type Owner = 'me' | 'unassigned' | ''

interface View {
  search: string
  status: TicketStatus | ''
  itPriority: ItPriority | ''
  categoryId: string
  owner: Owner
  sortBy: StaffQueueSortField
  sortDir: 'asc' | 'desc'
  page: number
}

const DEFAULT_VIEW: View = {
  search: '',
  status: '',
  itPriority: '',
  categoryId: '',
  owner: '',
  sortBy: 'updatedAt',
  sortDir: 'desc',
  page: 1,
}

const pick = <T extends string>(allowed: readonly T[], raw: string | null): T | '' =>
  (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : ''

/**
 * The view, read out of the address bar.
 *
 * The URL is the state rather than a copy of it. Staff open a Ticket from the
 * queue and come back, and "back" has to mean the same filters, sort and page
 * they left — which a `useState` forgets the moment the screen unmounts.
 *
 * Anything unrecognised falls back to its default, the same posture the API
 * takes (BR-30): a hand-edited or stale link still shows the queue.
 */
function readView(params: URLSearchParams): View {
  const page = Number(params.get('page'))

  return {
    search: params.get('search')?.trim() ?? '',
    status: pick(STATUSES, params.get('status')),
    itPriority: pick(IT_PRIORITIES, params.get('itPriority')),
    categoryId: /^[1-9]\d*$/.test(params.get('categoryId') ?? '') ? params.get('categoryId')! : '',
    owner: pick(['me', 'unassigned'] as const, params.get('owner')),
    sortBy:
      pick(
        SORTS.map((sort) => sort.field),
        params.get('sortBy'),
      ) || DEFAULT_VIEW.sortBy,
    sortDir: params.get('sortDir') === 'asc' ? 'asc' : 'desc',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  }
}

/** Defaults are left out, so the plain queue is `/staff/tickets` and not a
 *  URL that spells out eight things nobody chose. */
function writeView(view: View): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of Object.keys(view) as (keyof View)[]) {
    if (view[key] !== DEFAULT_VIEW[key]) params.set(key, String(view[key]))
  }
  return params
}

const toRequest = (view: View): StaffQueueParams => ({
  search: view.search || undefined,
  status: view.status || undefined,
  itPriority: view.itPriority || undefined,
  categoryId: view.categoryId ? Number(view.categoryId) : undefined,
  owner: view.owner || undefined,
  sortBy: view.sortBy,
  sortDir: view.sortDir,
  page: view.page,
})

const activeFilterCount = (view: View) =>
  [view.search, view.status, view.itPriority, view.categoryId, view.owner].filter(Boolean).length

type Load =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'forbidden' }
  | { state: 'ready'; response: StaffQueueResponse }

function OwnerCell({ owner }: { owner: StaffQueueItem['owner'] }) {
  return owner ? <>{owner.name}</> : <Badge tone="warning">Unassigned</Badge>
}

function Updated({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={formatAbsolute(iso)}>
      {formatRelative(iso)}
    </time>
  )
}

/**
 * IT Staff Ticket Queue (ui-spec.md §4; FR-13, BR-30, BR-31).
 *
 * For finding the next thing to work on and opening it. It reads every
 * Requester's Tickets, so the route sits behind a role guard and the API
 * refuses a Requester on its own account (AC-14) — this screen showing nothing
 * to them would not be a control.
 */
export function StaffTicketQueuePage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  // Handed to each Ticket link, so its Back returns to this view, filters and
  // page included, rather than to the plain queue.
  const returnTo = { from: `${location.pathname}${location.search}` }
  const view = useMemo(() => readView(params), [params])

  const [categories, setCategories] = useState<Category[]>([])
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  // The search box is the one control that does not apply as it changes: a
  // request per keystroke would race itself and flicker the list.
  const [searchText, setSearchText] = useState(view.search)
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    setSearchText(view.search)
  }, [view.search])

  /**
   * Any change to what is being looked at goes back to page 1; only paging
   * itself keeps the page.
   *
   * Whatever is in the search box goes along with every change. The box is the
   * one control that waits for a submit, so without this it could say
   * "printer" above a list that was never searched for it - text on screen
   * that the results do not reflect. And if that text differs from the search
   * in force, the set is a different one, so even a page change starts over.
   */
  const change = useCallback(
    (patch: Partial<View>) => {
      const search = patch.search ?? searchText.trim()
      const next = { ...view, page: 1, ...patch, search }
      if (search !== view.search) next.page = 1

      setParams(writeView(next), { replace: true })
    },
    [view, searchText, setParams],
  )

  const fetchQueue = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      setLoad({ state: 'loading' })
      try {
        const response = await fetchStaffTickets(toRequest(view))
        if (!isCurrent()) return

        // The server clamps a page past the end to the last real one (AC-26).
        // The address bar is corrected to match rather than left holding a
        // page that does not exist, where a copied or bookmarked link would
        // carry it on. That changes the view, which asks again for the page
        // now named; this response is dropped so the list is drawn once.
        // Clamping only ever lowers the page, so this cannot go round twice.
        if (response.pagination.page < view.page) {
          setParams(writeView({ ...view, page: response.pagination.page }), { replace: true })
          return
        }

        setLoad({ state: 'ready', response })
      } catch (failure) {
        if (!isCurrent()) return
        // 403 is not a bad minute. Asking again gets the same answer, so it
        // gets a way onward instead of a Retry.
        setLoad({
          state: failure instanceof ApiError && failure.status === 403 ? 'forbidden' : 'failed',
        })
      }
    },
    [view, setParams],
  )

  useEffect(() => {
    // Filters apply as they change, so two requests can be in flight at once.
    // Only the newest may land: an older, slower one must not overwrite the
    // rows for a filter the reader has already moved on from.
    let current = true
    void fetchQueue(() => current)
    return () => {
      current = false
    }
  }, [fetchQueue])

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setCategories([]))
  }, [])

  if (!user) return null

  const response = load.state === 'ready' ? load.response : null
  const rows = response?.data ?? []
  const pagination = response?.pagination
  const isEmptyQueue = Boolean(response) && rows.length === 0 && !response!.filtered
  const isNoResults = Boolean(response) && rows.length === 0 && response!.filtered
  const filterCount = activeFilterCount(view)

  function toggleSort(field: StaffQueueSortField) {
    change(
      view.sortBy === field
        ? { sortDir: view.sortDir === 'asc' ? 'desc' : 'asc' }
        : { sortBy: field, sortDir: 'desc' },
    )
  }

  function clearFilters() {
    // Emptied here as well as through the URL: text that was typed but never
    // submitted is not in the URL, so nothing there would change to clear it.
    setSearchText('')
    change({ search: '', status: '', itPriority: '', categoryId: '', owner: '' })
  }

  const sortHeader = (field: StaffQueueSortField, label: string) => (
    <th
      scope="col"
      aria-sort={
        view.sortBy === field ? (view.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
      }
    >
      <button type="button" onClick={() => toggleSort(field)}>
        {label}
        {view.sortBy === field && (
          <span aria-hidden="true">{view.sortDir === 'asc' ? ' ▲' : ' ▼'}</span>
        )}
      </button>
    </th>
  )

  return (
    <div className="ttk-queue">
      <div className="ttk-queue__head">
        <h2>Ticket Queue</h2>
        {pagination && pagination.totalItems > 0 && (
          <p className="ttk-queue__count">
            {pagination.totalItems} {pagination.totalItems === 1 ? 'Ticket' : 'Tickets'}
          </p>
        )}
      </div>

      {/* Hidden when the queue itself is empty: controls for narrowing
          nothing suggest there is something to narrow. */}
      {!isEmptyQueue && load.state !== 'forbidden' && (
        <>
          <Button
            variant="secondary"
            className="ttk-queue__filters-toggle"
            aria-expanded={filtersOpen}
            aria-controls="queue-controls"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            {filterCount > 0 ? `Filters (${filterCount})` : 'Filters'}
          </Button>

          <form
            id="queue-controls"
            className="ttk-queue__controls"
            data-open={filtersOpen}
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              change({ search: searchText.trim() })
            }}
          >
            <Field id="queue-search" label="Search" className="ttk-queue__search">
              {(attrs) => (
                <input
                  {...attrs}
                  type="search"
                  placeholder="Ticket Number or Summary"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                />
              )}
            </Field>

            <Field id="queue-status" label="Status">
              {(attrs) => (
                <select
                  {...attrs}
                  value={view.status}
                  onChange={(event) => change({ status: event.target.value as TicketStatus | '' })}
                >
                  <option value="">All statuses</option>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABEL[status]}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field id="queue-priority" label="IT Priority">
              {(attrs) => (
                <select
                  {...attrs}
                  value={view.itPriority}
                  onChange={(event) =>
                    change({ itPriority: event.target.value as ItPriority | '' })
                  }
                >
                  <option value="">All priorities</option>
                  {IT_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {IT_PRIORITY_LABEL[priority]}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field id="queue-category" label="Category">
              {(attrs) => (
                <select
                  {...attrs}
                  value={view.categoryId}
                  onChange={(event) => change({ categoryId: event.target.value })}
                >
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field id="queue-owner" label="Owner">
              {(attrs) => (
                <select
                  {...attrs}
                  value={view.owner}
                  onChange={(event) => change({ owner: event.target.value as Owner })}
                >
                  <option value="">All</option>
                  <option value="me">Mine</option>
                  <option value="unassigned">Unassigned</option>
                </select>
              )}
            </Field>

            <div className="ttk-queue__sort">
              <Field id="queue-sort" label="Sort by">
                {(attrs) => (
                  <select
                    {...attrs}
                    value={view.sortBy}
                    // Descending, as a header click on a new column is: a key
                    // chosen here must not inherit the last key's direction
                    // and open IT Priority on Low.
                    onChange={(event) =>
                      change({
                        sortBy: event.target.value as StaffQueueSortField,
                        sortDir: 'desc',
                      })
                    }
                  >
                    {SORTS.map((sort) => (
                      <option key={sort.field} value={sort.field}>
                        {sort.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Button
                variant="secondary"
                onClick={() => change({ sortDir: view.sortDir === 'asc' ? 'desc' : 'asc' })}
              >
                {view.sortDir === 'asc' ? 'Ascending' : 'Descending'}
              </Button>
            </div>

            <div className="ttk-queue__actions">
              <Button type="submit">Search</Button>
              {filterCount > 0 && (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          </form>
        </>
      )}

      {/* Skeleton rows rather than a spinner, so the page keeps its shape
          while a filter is applied instead of collapsing and springing back. */}
      {load.state === 'loading' && (
        <div className="ttk-queue__skeleton" role="status">
          <span className="ttk-visually-hidden">Loading the Ticket Queue…</span>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="ttk-queue__skeleton-row" aria-hidden="true" />
          ))}
        </div>
      )}

      {load.state === 'forbidden' && (
        <ErrorState
          title="You do not have permission to view this page"
          message="Your account does not have access to the Ticket Queue."
          actionLabel="Go to your home page"
          actionTo={landingPathFor(user.role)}
        />
      )}

      {load.state === 'failed' && (
        <ErrorState
          title="Unable to load the Ticket Queue"
          message="The queue could not be loaded. Check that the TokTickIT API is running, then try again."
          onRetry={() => void fetchQueue()}
        />
      )}

      {isEmptyQueue && <EmptyState title="No Tickets in the queue yet." />}

      {/* Different words and a different way out from the Empty state above:
          there are Tickets, just none under these filters (AC-23). */}
      {isNoResults && (
        <EmptyState
          title="No Tickets match these filters."
          message="Try a different search term, or clear the filters to see the whole queue."
          action={
            <Button variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      )}

      {rows.length > 0 && (
        <>
          <div className="ttk-queue__table-wrap">
            <table className="ttk-queue__table">
              <caption className="ttk-visually-hidden">
                Ticket Queue, sorted by {SORTS.find((sort) => sort.field === view.sortBy)?.label}{' '}
                {view.sortDir === 'asc' ? 'ascending' : 'descending'}
              </caption>
              <thead>
                <tr>
                  {sortHeader('ticketNumber', 'Ticket Number')}
                  <th scope="col">Summary</th>
                  <th scope="col" className="ttk-queue__wide-only">
                    Category
                  </th>
                  <th scope="col" className="ttk-queue__wide-only">
                    Requested
                  </th>
                  {sortHeader('itPriority', 'IT Priority')}
                  {sortHeader('currentStatus', 'Status')}
                  <th scope="col">Owner</th>
                  {sortHeader('updatedAt', 'Last Updated')}
                </tr>
              </thead>
              <tbody>
                {rows.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      <Link to={`/staff/tickets/${ticket.id}`}
                        state={returnTo} className="ttk-queue__number">
                        {ticket.ticketNumber}
                      </Link>
                    </td>
                    <td className="ttk-queue__summary-cell">
                      <span className="ttk-queue__summary" title={ticket.summary}>
                        {ticket.summary}
                      </span>
                      {/* Tablet only: the two columns that collapse come to
                          rest here, as the Summary's second line. */}
                      <span className="ttk-queue__summary-meta">
                        {ticket.category.name} · Requested{' '}
                        <RequestedPriorityBadge priority={ticket.requestedPriority} />
                      </span>
                    </td>
                    <td className="ttk-queue__wide-only">{ticket.category.name}</td>
                    <td className="ttk-queue__wide-only">
                      <RequestedPriorityBadge priority={ticket.requestedPriority} />
                    </td>
                    <td>
                      <ItPriorityBadge priority={ticket.itPriority} />
                    </td>
                    <td>
                      <StatusBadge status={ticket.currentStatus} />
                    </td>
                    <td>
                      <OwnerCell owner={ticket.owner} />
                    </td>
                    <td className="ttk-queue__updated">
                      <Updated iso={ticket.updatedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="ttk-queue__cards">
            {rows.map((ticket) => (
              <li key={ticket.id}>
                {/* The whole card is the link, so the tap target is the card
                    and not a line of text inside it. */}
                <Link to={`/staff/tickets/${ticket.id}`}
                        state={returnTo} className="ttk-queue__card">
                  <span className="ttk-queue__card-row">
                    <span className="ttk-queue__number">{ticket.ticketNumber}</span>
                    <StatusBadge status={ticket.currentStatus} />
                  </span>
                  <span className="ttk-queue__card-summary">{ticket.summary}</span>
                  <span className="ttk-queue__card-row">
                    <ItPriorityBadge priority={ticket.itPriority} />
                    <span className="ttk-queue__card-owner">
                      <OwnerCell owner={ticket.owner} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {pagination && pagination.totalPages > 1 && (
            <nav className="ttk-queue__pagination" aria-label="Ticket Queue pages">
              {/* Stepped from the page the server served, not the one asked
                  for: they differ when a page past the end was clamped. */}
              <Button
                variant="secondary"
                onClick={() => change({ page: pagination.page - 1 })}
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
