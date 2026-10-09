import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatAbsolute, formatRelative } from '../pages/relativeTime'
import './Dashboard.css'

/**
 * The parts both dashboards are built from (ui-spec.md §2): a metric card and
 * a list of at most five rows.
 */

export interface MetricCardProps {
  label: string
  /** Shown as it is, so zero is `0` and never a dash or a blank. */
  value: number
  /** Where the count leads. Without it the card is plain text: not a link,
   *  no "View all", not focusable. */
  to?: string
  /** A second line for a card with no drill-down, such as which day "today" is. */
  note?: string
  testId?: string
}

export function MetricCard({ label, value, to, note, testId }: MetricCardProps) {
  const body = (
    <>
      <span className="ttk-metric__label">{label}</span>
      <span className="ttk-metric__value" data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </span>
      {to && <span className="ttk-metric__action">View all</span>}
      {note && <span className="ttk-metric__note">{note}</span>}
    </>
  )

  if (!to) {
    return (
      <div className="ttk-card ttk-metric" data-testid={testId}>
        {body}
      </div>
    )
  }

  return (
    <Link
      to={to}
      className="ttk-card ttk-metric ttk-metric--link"
      aria-label={`${label}, ${value}, view all`}
      data-testid={testId}
    >
      {body}
    </Link>
  )
}

export interface DashboardListProps {
  title: string
  /** One line of text shown in place of rows. The list is never hidden when
   *  empty: a section that vanishes looks like a fault. */
  emptyText: string
  /** Each child is one `<li>`. */
  children: ReactNode[]
  viewAllTo?: string
  /** The warning rule down the left edge, for a list that wants a response.
   *  Only drawn while there is something in it. */
  attention?: boolean
  testId?: string
}

export function DashboardList({
  title,
  emptyText,
  children,
  viewAllTo,
  attention = false,
  testId,
}: DashboardListProps) {
  const headingId = `${testId ?? title.replace(/\W+/g, '-').toLowerCase()}-heading`
  const hasRows = children.length > 0

  return (
    <section
      className={`ttk-card ttk-dash-list${attention && hasRows ? ' ttk-dash-list--attention' : ''}`}
      aria-labelledby={headingId}
      data-testid={testId}
    >
      <div className="ttk-dash-list__head">
        <h3 id={headingId}>{title}</h3>
        {viewAllTo && hasRows && (
          <Link to={viewAllTo} className="ttk-dash-list__all" aria-label={`View all: ${title}`}>
            View all
          </Link>
        )}
      </div>
      {hasRows ? (
        <ul className="ttk-dash-list__rows">{children}</ul>
      ) : (
        <p className="ttk-dash-list__empty">{emptyText}</p>
      )}
    </section>
  )
}

/** A relative time with the full timestamp behind it, as the queue shows one. */
export function DashboardTime({ iso, prefix }: { iso: string; prefix?: string }) {
  return (
    <time className="ttk-dash-row__time" dateTime={iso} title={formatAbsolute(iso)}>
      {prefix ? `${prefix} ` : ''}
      {formatRelative(iso)}
    </time>
  )
}

export interface DashboardRowProps {
  to: string
  /** The Ticket Number, or the date for an Action Taken: the part that must
   *  never wrap or truncate. */
  lead: ReactNode
  /** One truncated line. The full text is its `title`. */
  text: string
  /** Badges and the date. */
  children: ReactNode
}

/** One row, one link. */
export function DashboardRow({ to, lead, text, children }: DashboardRowProps) {
  return (
    <li>
      <Link to={to} className="ttk-dash-row">
        <span className="ttk-dash-row__lead">{lead}</span>
        <span className="ttk-dash-row__text" title={text}>
          {text}
        </span>
        <span className="ttk-dash-row__meta">{children}</span>
      </Link>
    </li>
  )
}
