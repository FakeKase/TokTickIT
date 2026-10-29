import { Link } from 'react-router-dom'
import { fetchStaffDashboard } from '../api'
import { landingPathFor } from '../auth/landing'
import { useAuth } from '../auth/useAuth'
import { Badge } from '../components/Badge'
import {
  DashboardList,
  DashboardRow,
  DashboardTime,
  MetricCard,
} from '../components/Dashboard'
import { useDashboard } from '../components/useDashboard'
import { ErrorState } from '../components/ErrorState'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { ItPriorityBadge, StatusBadge } from '../components/TicketBadges'
import { STATUS_LABEL } from '../components/ticketLabels'
import { formatAbsolute } from './relativeTime'

/** The words for each count. The numbers, their order and where each leads
 *  all come from the response (api-spec.md §9). */
const METRIC_LABEL: Record<string, string> = {
  unassigned: 'Unassigned',
  myTickets: 'My Tickets',
  urgent: 'Urgent',
  myActionsToday: 'My Actions Today',
}

const firstName = (name: string) => name.trim().split(/\s+/)[0]

/**
 * IT Staff Dashboard (ui-spec.md §4; FR-10 to FR-12).
 *
 * An Administrator gets the same screen with one more card. Whether that card
 * exists is decided by whether the server sent the counts, not by reading the
 * role here: IT Staff are not sent them (BR-29), so there is nothing to hide.
 */
export function StaffDashboardPage() {
  const { user } = useAuth()
  const { load, reload } = useDashboard(fetchStaffDashboard)

  if (!user) return null

  const body = load.state === 'ready' ? load.body : null

  return (
    <div className="ttk-dash">
      <div className="ttk-dash__head">
        <div>
          <h2>Welcome back, {firstName(user.name)}</h2>
          <p className="ttk-dash__lead">Here is what is happening in the queue.</p>
        </div>
      </div>

      {load.state === 'loading' && <LoadingSpinner label="Loading the dashboard…" />}

      {load.state === 'failed' && (
        <ErrorState
          title="Unable to load the dashboard"
          message="The dashboard could not be loaded. Check that the TokTickIT API is running, then try again."
          onRetry={reload}
          retryLabel="Try again"
        />
      )}

      {load.state === 'forbidden' && (
        <ErrorState
          title="You do not have permission to view this page"
          message="This dashboard is for IT Staff and Administrators."
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
                to={metric.query === null ? undefined : `/staff/tickets?${metric.query}`}
                // "Today" is a Bangkok day wherever the reader is (BR-25).
                note={metric.key === 'myActionsToday' ? 'Bangkok time' : undefined}
              />
            ))}
          </div>

          <div className="ttk-dash__lists ttk-dash__section">
            <section
              className="ttk-card ttk-dash-list"
              aria-labelledby="by-status-heading"
              data-testid="by-status"
            >
              <div className="ttk-dash-list__head">
                <h3 id="by-status-heading">Tickets by Status</h3>
              </div>
              {/* All eight, always: a status with no Tickets is `0` and still
                  a link, so the card has the same shape every day. */}
              <ul className="ttk-dash-status">
                {body.byStatus.map((row) => (
                  <li key={row.status}>
                    <Link
                      to={`/staff/tickets?${row.query}`}
                      aria-label={`${STATUS_LABEL[row.status] ?? row.status}, ${row.value}, view all`}
                    >
                      <StatusBadge status={row.status} />
                      <span className="ttk-dash-status__count">{row.value}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            {body.users && (
              <section
                className="ttk-card ttk-dash-list"
                aria-labelledby="user-accounts-heading"
                data-testid="user-accounts"
              >
                <div className="ttk-dash-list__head">
                  <h3 id="user-accounts-heading">User accounts</h3>
                  <Link
                    to="/admin/users"
                    className="ttk-dash-list__all"
                    aria-label="User accounts: open User Management"
                  >
                    Manage users
                  </Link>
                </div>
                <ul className="ttk-dash-status">
                  <li className="ttk-dash-users">
                    <span>Active</span>
                    <span className="ttk-dash-status__count" data-testid="users-active">
                      {body.users.active}
                    </span>
                  </li>
                  <li className="ttk-dash-users">
                    <span>Inactive</span>
                    <span className="ttk-dash-status__count" data-testid="users-inactive">
                      {body.users.inactive}
                    </span>
                  </li>
                </ul>
              </section>
            )}
          </div>

          <div className="ttk-dash__lists">
            <DashboardList
              title="Recently updated Tickets"
              testId="list-recently-updated"
              emptyText="No Tickets yet."
              viewAllTo="/staff/tickets"
            >
              {body.recentlyUpdated.map((ticket) => (
                <DashboardRow
                  key={ticket.id}
                  to={`/staff/tickets/${ticket.id}`}
                  lead={ticket.ticketNumber}
                  text={ticket.summary}
                >
                  <StatusBadge status={ticket.currentStatus} />
                  <ItPriorityBadge priority={ticket.itPriority} />
                  {ticket.owner ? (
                    <span>{ticket.owner.name}</span>
                  ) : (
                    <Badge tone="warning">Unassigned</Badge>
                  )}
                  <DashboardTime iso={ticket.updatedAt} prefix="Updated" />
                </DashboardRow>
              ))}
            </DashboardList>

            <DashboardList
              title="My recent Actions Taken"
              testId="list-my-actions"
              emptyText="You have not recorded any Actions Taken yet."
            >
              {body.myRecentActions.map((action) => (
                <DashboardRow
                  key={action.id}
                  // The Ticket's own screen, at the area the row is about.
                  to={`/staff/tickets/${action.ticketId}#actions-taken`}
                  lead={action.ticketNumber}
                  text={action.descriptionPreview}
                >
                  <time dateTime={action.actionAt} className="ttk-dash-row__time">
                    {formatAbsolute(action.actionAt)}
                  </time>
                  {action.followUpRequired && <Badge tone="warning">Follow-up required</Badge>}
                </DashboardRow>
              ))}
            </DashboardList>
          </div>
        </>
      )}
    </div>
  )
}
