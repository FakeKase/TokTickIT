import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchTicket } from '../api'
import type { RequestedPriority, TicketDetail } from '../api'
import { Badge } from '../components/Badge'
import type { BadgeTone } from '../components/Badge'
import { Card } from '../components/Card'
import { ErrorState } from '../components/ErrorState'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useSelectedRequester } from '../requester/useSelectedRequester'
import './TicketDetailPage.css'

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

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase()
}

/**
 * A single labelled value in the header card. Rendered as a definition list
 * pair rather than a disabled input: these are facts about the Ticket, not
 * controls that happen to be switched off (ui-spec.md §3, AC-17).
 */
function ReadOnlyField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="ttk-detail__field">
      <dt className="ttk-field__label">{label}</dt>
      <dd className="ttk-detail__value">{children}</dd>
    </div>
  )
}

/**
 * Requester Ticket Detail (ui-spec.md §6.4): the header card, read-only.
 *
 * The Attachments panel is Issue #18 and is deliberately absent rather than
 * stubbed — a disabled-looking panel would imply an action that does not
 * exist yet. Public Comments, Internal Notes, Actions Taken and any status
 * control stay out entirely (handout §4.2).
 */
export function TicketDetailPage() {
  const { id } = useParams()
  const { requester } = useSelectedRequester()

  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [failed, setFailed] = useState(false)

  const ticketId = Number(id)
  const requesterId = requester?.id

  const load = useCallback(async () => {
    if (!requesterId) return
    setLoading(true)
    setNotFound(false)
    setFailed(false)

    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      setNotFound(true)
      setLoading(false)
      return
    }

    try {
      setTicket(await fetchTicket(ticketId, requesterId))
    } catch (error) {
      // BR-08 makes 404 mean "not found OR not yours", indistinguishable on
      // purpose — so the copy must not claim the Ticket exists.
      if (error instanceof Error && /not found/i.test(error.message)) {
        setNotFound(true)
      } else {
        setFailed(true)
      }
      setTicket(null)
    } finally {
      setLoading(false)
    }
  }, [ticketId, requesterId])

  useEffect(() => {
    void load()
  }, [load])

  if (!requester) return null

  return (
    <div className="ttk-detail">
      <p className="ttk-detail__back">
        <Link to="/tickets">← Back to My Tickets</Link>
      </p>

      {loading && <LoadingSpinner label="Loading the Ticket…" />}

      {!loading && notFound && (
        <ErrorState
          title="Ticket not found"
          message="This Ticket does not exist, or it belongs to a different Requester."
        />
      )}

      {!loading && failed && (
        <ErrorState
          title="Unable to load the Ticket"
          message="The Ticket could not be loaded. Check that the TokTickIT API is running, then try again."
          onRetry={() => void load()}
        />
      )}

      {!loading && ticket && (
        <Card className="ttk-detail__card">
          <div className="ttk-detail__heading">
            <h2>{ticket.ticketNumber}</h2>
          </div>

          <dl className="ttk-detail__grid">
            <ReadOnlyField label="Created Date">
              {formatDateTime(ticket.createdAt)}
            </ReadOnlyField>
            <ReadOnlyField label="Last Updated">
              {formatDateTime(ticket.updatedAt)}
            </ReadOnlyField>
            <ReadOnlyField label="Requester">{ticket.requester.name}</ReadOnlyField>
            <ReadOnlyField label="Category">{ticket.category.name}</ReadOnlyField>
            <ReadOnlyField label="Related System">
              {ticket.relatedSystem.name}
            </ReadOnlyField>
            <ReadOnlyField label="Requested Priority">
              <Badge tone={PRIORITY_TONE[ticket.requestedPriority]}>
                {PRIORITY_LABEL[ticket.requestedPriority]}
              </Badge>
            </ReadOnlyField>
            <ReadOnlyField label="Current Status">
              <Badge tone="pale">{statusLabel(ticket.currentStatus)}</Badge>
            </ReadOnlyField>
          </dl>

          <dl className="ttk-detail__wide">
            <ReadOnlyField label="Summary">{ticket.summary}</ReadOnlyField>
            <ReadOnlyField label="Description">
              <span className="ttk-detail__description">{ticket.description}</span>
            </ReadOnlyField>
          </dl>
        </Card>
      )}
    </div>
  )
}
