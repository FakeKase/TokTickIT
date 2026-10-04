import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, fetchComments, fetchTicket } from '../api'
import type { RequestedPriority, TicketComment, TicketDetail } from '../api'
import { Badge } from '../components/Badge'
import type { BadgeTone } from '../components/Badge'
import { AttachmentSection } from '../components/AttachmentSection'
import { CommentThread } from '../components/CommentThread'
import { ResolvedSignal } from '../components/ResolvedSignal'
import { Card } from '../components/Card'
import { StatusBadge } from '../components/TicketBadges'
import { ErrorState } from '../components/ErrorState'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useAuth } from '../auth/useAuth'
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
 * Requester Ticket Detail (ui-spec.md §6): a read-only header card, the
 * Attachments panel, and - new in Lab 3 - the public comment thread and the
 * "problem appears resolved" signal.
 *
 * Still no status control and no internal notes. The Requester says what they
 * see; IT Staff decide what the Ticket is (BR-05), and an internal note never
 * reaches this screen because the server does not send it (BR-04).
 */
export function TicketDetailPage() {
  const { id } = useParams()
  // Identity comes from the session and never leaves this component: no call
  // below carries a Requester id, because the server takes it from the cookie
  // (BR-03).
  const { user: requester } = useAuth()

  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [comments, setComments] = useState<TicketComment[]>([])
  const [commentsFailed, setCommentsFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [failed, setFailed] = useState(false)

  const ticketId = Number(id)
  const signedInUserId = requester?.id

  const load = useCallback(async () => {
    if (!signedInUserId) return
    setLoading(true)
    setNotFound(false)
    setFailed(false)

    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      setNotFound(true)
      setLoading(false)
      return
    }

    try {
      setTicket(await fetchTicket(ticketId))
    } catch (error) {
      // Branch on the status, not the message: the wording is presentation
      // and either side could reword it, whereas 404 is the contract.
      // BR-08 makes that 404 mean "not found OR not yours", indistinguishable
      // on purpose — so the copy must not claim the Ticket exists, and it
      // must not offer a Retry that can never succeed.
      if (error instanceof ApiError && error.status === 404) {
        setNotFound(true)
      } else {
        setFailed(true)
      }
      setTicket(null)
    } finally {
      setLoading(false)
    }
  }, [ticketId, signedInUserId])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * The thread is loaded separately from the Ticket on purpose.
   *
   * Fetching both together means one failure takes the other down: a comments
   * endpoint having a bad minute would replace a perfectly good Ticket with a
   * page-wide error state. The Ticket is what the person came for, and the
   * thread degrades to its own retry.
   */
  const loadComments = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!signedInUserId || !Number.isInteger(ticketId) || ticketId <= 0) return
      setCommentsFailed(false)

      try {
        const thread = await fetchComments(ticketId)
        // Dropped if the id moved on while this was in flight: a slow fetch
        // for Ticket 41 must not land in the thread for Ticket 42.
        if (isCurrent()) setComments(thread)
      } catch {
        if (isCurrent()) setCommentsFailed(true)
      }
    },
    [signedInUserId, ticketId],
  )

  useEffect(() => {
    let current = true
    // Cleared first, so the previous Ticket's conversation is not on screen
    // while this one loads.
    setComments([])
    void loadComments(() => current)
    return () => {
      current = false
    }
  }, [loadComments])

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
              <StatusBadge status={ticket.currentStatus} />
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

      {!loading && ticket && (
        <>
          <AttachmentSection
            ticketId={ticket.id}
            attachments={ticket.attachments}
            onChange={(attachments) => setTicket({ ...ticket, attachments })}
          />

          <ResolvedSignal
            ticketId={ticket.id}
            currentStatus={ticket.currentStatus}
            resolvedAt={ticket.requesterResolvedAt ?? null}
            onSignalled={(signal) => {
              setTicket({ ...ticket, requesterResolvedAt: signal.requesterResolvedAt })
              void loadComments()
            }}
            onStale={() => {
              // Both, because a refused signal means either could have moved:
              // the Ticket's status and timestamp, and the thread that the
              // other tab's signal appended a comment to.
              void load()
              void loadComments()
            }}
          />

          <CommentThread
            ticketId={ticket.id}
            comments={comments}
            failed={commentsFailed}
            onRetry={() => void loadComments()}
            onPosted={(comment) => setComments((previous) => [...previous, comment])}
          />
        </>
      )}
    </div>
  )
}
