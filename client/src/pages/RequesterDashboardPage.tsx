import { useNavigate } from 'react-router-dom'
import { fetchRequesterDashboard } from '../api'
import type { DashboardTicketRow } from '../api'
import { landingPathFor } from '../auth/landing'
import { useAuth } from '../auth/useAuth'
import { Button } from '../components/Button'
import {
  DashboardList,
  DashboardRow,
  DashboardTime,
  MetricCard,
} from '../components/Dashboard'
import { useDashboard } from '../components/useDashboard'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { StatusBadge } from '../components/TicketBadges'

/** The words for each count. The numbers, their order and where each leads
 *  all come from the response (api-spec.md §8). */
const METRIC_LABEL: Record<string, string> = {
  openTickets: 'Open Tickets',
  waitingForYou: 'Waiting for You',
  resolved: 'Resolved',
  closed: 'Closed',
}

const firstName = (name: string) => name.trim().split(/\s+/)[0]

function TicketRow({ ticket, dated }: { ticket: DashboardTicketRow; dated: React.ReactNode }) {
  return (
    <DashboardRow to={`/tickets/${ticket.id}`} lead={ticket.ticketNumber} text={ticket.summary}>
      <StatusBadge status={ticket.currentStatus} />
      {dated}
    </DashboardRow>
  )
}

/**
 * Requester Dashboard (ui-spec.md §3; FR-09, FR-12).
 *
 * A summary and a way in, not a second My Tickets: five rows and a link is
 * the most it shows of any list. Whose Tickets are counted is decided by the
 * session on the server; nothing here sends an id.
 */
export function RequesterDashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { load, reload } = useDashboard(fetchRequesterDashboard)

  if (!user) return null

  const createTicket = <Button onClick={() => navigate('/tickets/new')}>Create Ticket</Button>
  const body = load.state === 'ready' ? load.body : null
  // Recently updated lists every Ticket the Requester has, newest first, so
  // an empty one means there are none at all.
  const emptyAccount = body !== null && body.recentlyUpdated.length === 0

  return (
    <div className="ttk-dash">
      <div className="ttk-dash__head">
        <div>
          <h2>Welcome, {firstName(user.name)}</h2>
          <p className="ttk-dash__lead">Here is the latest on your Tickets.</p>
        </div>
        {load.state !== 'forbidden' && createTicket}
      </div>

      {load.state === 'loading' && <LoadingSpinner label="Loading your dashboard…" />}

      {/* No card or number beside the failure: a partial figure would be read
          as a real one. */}
      {load.state === 'failed' && (
        <ErrorState
          title="Unable to load your dashboard"
          message="Your dashboard could not be loaded. Check that the TokTickIT API is running, then try again."
          onRetry={reload}
          retryLabel="Try again"
        />
      )}

      {load.state === 'forbidden' && (
        <ErrorState
          title="You do not have permission to view this page"
          message="This dashboard is for Requesters."
          actionLabel="Go to your home page"
          actionTo={landingPathFor(user.role)}
        />
      )}

      {body && (
        <>
          <div className="ttk-dash__metrics">
            {body.metrics.map((metric) => (
              <MetricCard
                key={metric.key}
                testId={`metric-${metric.key}`}
                label={METRIC_LABEL[metric.key] ?? metric.key}
                value={metric.value}
                to={metric.query === null ? undefined : `/tickets?${metric.query}`}
              />
            ))}
          </div>

          {/* The cards stay because zero is the true count; the lists go
              because three "nothing here" lines say less than one. */}
          {emptyAccount ? (
            <EmptyState
              title="You have not created any Tickets yet"
              message="When you submit a Ticket it will appear here, along with its official Ticket Number."
              action={createTicket}
            />
          ) : (
            <div className="ttk-dash__lists">
              <DashboardList
                title="Needs your attention"
                testId="list-needs-attention"
                emptyText="Nothing is waiting for you."
                viewAllTo="/tickets?status=WAITING_FOR_REQUESTER"
                attention
              >
                {body.needsAttention.map((ticket) => (
                  <TicketRow
                    key={ticket.id}
                    ticket={ticket}
                    dated={<DashboardTime iso={ticket.updatedAt} prefix="Updated" />}
                  />
                ))}
              </DashboardList>

              <DashboardList
                title="Recently updated"
                testId="list-recently-updated"
                emptyText="No Tickets yet."
                viewAllTo="/tickets?sortBy=updatedAt"
              >
                {body.recentlyUpdated.map((ticket) => (
                  <TicketRow
                    key={ticket.id}
                    ticket={ticket}
                    dated={<DashboardTime iso={ticket.updatedAt} prefix="Updated" />}
                  />
                ))}
              </DashboardList>

              <DashboardList
                title="Recently resolved"
                testId="list-recently-resolved"
                emptyText="Nothing was resolved in the last 7 days."
              >
                {body.recentlyResolved.map((ticket) => (
                  <TicketRow
                    key={ticket.id}
                    ticket={ticket}
                    dated={<DashboardTime iso={ticket.resolvedAt} prefix="Resolved" />}
                  />
                ))}
              </DashboardList>
            </div>
          )}
        </>
      )}
    </div>
  )
}
