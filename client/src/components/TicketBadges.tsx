import type { ItPriority, RequestedPriority, TicketStatus } from '../api'
import { Badge } from './Badge'
import type { BadgeTone } from './Badge'
import { STATUS_LABEL } from './ticketLabels'

/**
 * The three workflow badge families (ui-spec.md §3), in one place.
 *
 * Every screen that shows a Ticket shows some of these, and the label for a
 * status has to be the same word everywhere. Lab 2 derived it from the enum
 * (`NEW` -> "New"), which was fine while New was the only status and turns
 * `WAITING_FOR_REQUESTER` into "Waiting_for_requester" now that it is not.
 */

const REQUESTED: Record<RequestedPriority, { label: string; tone: BadgeTone }> = {
  LOW: { label: 'Low', tone: 'pale' },
  MEDIUM: { label: 'Medium', tone: 'warning' },
  HIGH: { label: 'High', tone: 'danger' },
}

const IT_PRIORITY: Record<ItPriority, { label: string; tone: BadgeTone }> = {
  LOW: { label: 'Low', tone: 'neutral' },
  MEDIUM: { label: 'Medium', tone: 'warning' },
  HIGH: { label: 'High', tone: 'danger' },
  URGENT: { label: 'Urgent', tone: 'urgent' },
}

const STATUS_TONE: Record<TicketStatus, BadgeTone> = {
  NEW: 'pale',
  OPEN: 'pale',
  REOPENED: 'pale',
  IN_PROGRESS: 'active',
  WAITING_FOR_REQUESTER: 'warning',
  RESOLVED: 'neutral',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
}

const FINISHED: TicketStatus[] = ['RESOLVED', 'CLOSED']

export function RequestedPriorityBadge({ priority }: { priority: RequestedPriority }) {
  const { label, tone } = REQUESTED[priority]
  return <Badge tone={tone}>{label}</Badge>
}

export function ItPriorityBadge({ priority }: { priority: ItPriority }) {
  const { label, tone } = IT_PRIORITY[priority]
  return <Badge tone={tone}>{label}</Badge>
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  // A status this build has never heard of still renders as a word rather
  // than nothing: the server may learn a new value before the client does.
  const label = STATUS_LABEL[status] ?? status

  return (
    <Badge
      tone={STATUS_TONE[status] ?? 'neutral'}
      className={status === 'CANCELLED' ? 'ttk-badge--struck' : undefined}
    >
      {FINISHED.includes(status) && <span aria-hidden="true">✓&nbsp;</span>}
      {label}
    </Badge>
  )
}
