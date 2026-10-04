import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import {
  ApiError,
  attachmentDownloadUrl,
  fetchAssignableUsers,
  fetchComments,
  fetchStaffTicket,
  setItPriority,
  setTicketOwner,
  setTicketStatus,
} from '../api'
import type {
  AssignableUser,
  ItPriority,
  StaffTicketDetail,
  TicketComment,
  TicketStatus,
} from '../api'
import { landingPathFor } from '../auth/landing'
import { useAuth } from '../auth/useAuth'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { CommentThread } from '../components/CommentThread'
import type { CommentStream } from '../components/CommentThread'
import { ErrorState } from '../components/ErrorState'
import { Field } from '../components/Field'
import { LoadingSpinner } from '../components/LoadingSpinner'
import {
  ItPriorityBadge,
  RequestedPriorityBadge,
  StatusBadge,
} from '../components/TicketBadges'
import { IT_PRIORITY_LABEL, STATUS_LABEL } from '../components/ticketLabels'
import { formatFileSize } from './createTicketValidation'
import { formatAbsolute } from './relativeTime'
import './TicketDetailPage.css'
import './StaffTicketDetailPage.css'

const IT_PRIORITIES = Object.keys(IT_PRIORITY_LABEL) as ItPriority[]

const ROLE_LABEL: Record<string, string> = {
  IT_STAFF: 'IT Staff',
  ADMINISTRATOR: 'Administrator',
}

/** Two streams with two composers, never one composer with a switch: a
 *  toggle is one mis-click from publishing a note to the Requester
 *  (ui-spec.md §5). Each names its own visibility, so neither relies on a
 *  default. */
const PUBLIC_STREAM: CommentStream = {
  visibility: 'PUBLIC',
  title: 'Public Comments',
  audience: 'Visible to the Requester.',
  empty: 'No public comments yet.',
  fieldId: 'public-comment-body',
  fieldLabel: 'Add a public comment',
  submitLabel: 'Post comment',
}

const INTERNAL_STREAM: CommentStream = {
  visibility: 'INTERNAL',
  title: 'Internal Notes',
  audience: 'IT Staff and Administrators only. The Requester never sees these.',
  empty: 'No internal notes yet.',
  fieldId: 'internal-note-body',
  fieldLabel: 'Add an internal note',
  submitLabel: 'Add internal note',
  internal: true,
}

type Load = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'failed'
type Control = 'owner' | 'priority' | 'status'

function ReadOnlyField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ttk-detail__field">
      <dt className="ttk-field__label">{label}</dt>
      <dd className="ttk-detail__value">{children}</dd>
    </div>
  )
}

/**
 * IT Staff Ticket Detail (ui-spec.md §5; FR-14 to FR-19).
 *
 * The Ticket's own facts are read-only, as on the Requester's screen. The
 * workflow panel is the one region that acts, and it is set apart so that
 * nothing above it reads as editable.
 *
 * Every control sends one request and takes the whole Ticket back. A refusal
 * with 409 means this screen is behind the database - a colleague moved the
 * Ticket - so the Ticket is reloaded and the refusal shown, rather than
 * leaving controls on screen that describe a state that no longer exists.
 */
export function StaffTicketDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const location = useLocation()
  const ticketId = Number(id)

  // Where the queue link put us, filters and all, so Back returns to the view
  // that was left rather than to an unfiltered page 1.
  const backTo = (location.state as { from?: string } | null)?.from ?? '/staff/tickets'

  const [load, setLoad] = useState<Load>('loading')
  const [ticket, setTicket] = useState<StaffTicketDetail | null>(null)
  const [comments, setComments] = useState<TicketComment[]>([])
  const [commentsFailed, setCommentsFailed] = useState(false)
  const [assignable, setAssignable] = useState<AssignableUser[]>([])

  const [saving, setSaving] = useState<Control | null>(null)
  const [errors, setErrors] = useState<Partial<Record<Control, string>>>({})
  const [announcement, setAnnouncement] = useState('')
  const [nextStatus, setNextStatus] = useState<TicketStatus | ''>('')

  const validId = Number.isInteger(ticketId) && ticketId > 0

  const loadTicket = useCallback(
    async (isCurrent: () => boolean = () => true, quiet = false) => {
      if (!validId) {
        setLoad('not-found')
        return
      }
      if (!quiet) setLoad('loading')

      try {
        const loaded = await fetchStaffTicket(ticketId)
        if (!isCurrent()) return
        setTicket(loaded)
        setLoad('ready')
      } catch (failure) {
        if (!isCurrent()) return
        const status = failure instanceof ApiError ? failure.status : 0
        setTicket(null)
        setLoad(status === 404 ? 'not-found' : status === 403 ? 'forbidden' : 'failed')
      }
    },
    [ticketId, validId],
  )

  // Loaded apart from the Ticket, as on the Requester's screen: a comments
  // endpoint having a bad minute must not take a good Ticket down with it.
  const loadComments = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!validId) return
      setCommentsFailed(false)
      try {
        const thread = await fetchComments(ticketId)
        if (isCurrent()) setComments(thread)
      } catch {
        if (isCurrent()) setCommentsFailed(true)
      }
    },
    [ticketId, validId],
  )

  useEffect(() => {
    let current = true
    setComments([])
    setErrors({})
    setNextStatus('')
    void loadTicket(() => current)
    void loadComments(() => current)
    return () => {
      current = false
    }
  }, [loadTicket, loadComments])

  useEffect(() => {
    // The reassign list failing leaves Claim and everything else working, so
    // it degrades to an empty select rather than a failed screen.
    fetchAssignableUsers()
      .then(setAssignable)
      .catch(() => setAssignable([]))
  }, [])

  if (!user) return null

  /** Runs one workflow change and settles the screen afterwards. */
  async function change(
    control: Control,
    request: () => Promise<StaffTicketDetail>,
    done: (updated: StaffTicketDetail) => string,
  ) {
    if (saving) return
    setSaving(control)
    setErrors((previous) => ({ ...previous, [control]: undefined }))
    setAnnouncement('')

    try {
      const updated = await request()
      setTicket(updated)
      setAnnouncement(done(updated))
      if (control === 'status') setNextStatus('')
    } catch (failure) {
      const refused = failure instanceof ApiError && failure.status === 409
      setErrors((previous) => ({
        ...previous,
        [control]:
          // The server's wording for a refusal is written for this screen
          // (api-spec.md §12): it says which move was refused and why.
          refused && failure instanceof ApiError
            ? failure.message
            : 'That change could not be saved. Please try again.',
      }))
      // Refused means out of date, so bring the Ticket up to date. The
      // message stays; the controls underneath it become true again.
      if (refused) {
        setNextStatus('')
        void loadTicket(undefined, true)
      }
    } finally {
      setSaving(null)
    }
  }

  const ownedByMe = ticket?.owner?.id === user.id
  const chosen = ticket?.transitions.find((move) => move.to === nextStatus)
  const blockedByOwner = Boolean(chosen?.requiresOwner && !ticket?.owner)
  const anyNeedsOwner = Boolean(
    ticket && !ticket.owner && ticket.transitions.some((move) => move.requiresOwner),
  )

  return (
    <div className="ttk-detail ttk-staff-detail">
      <p className="ttk-detail__back">
        <Link to={backTo}>← Back to Ticket Queue</Link>
      </p>

      {load === 'loading' && <LoadingSpinner label="Loading the Ticket…" />}

      {load === 'not-found' && (
        <ErrorState title="Ticket not found" message="There is no Ticket with this id." />
      )}

      {load === 'forbidden' && (
        <ErrorState
          title="You do not have permission to view this page"
          message="Your account does not have access to this Ticket."
          actionLabel="Go to your home page"
          actionTo={landingPathFor(user.role)}
        />
      )}

      {load === 'failed' && (
        <ErrorState
          title="Unable to load the Ticket"
          message="The Ticket could not be loaded. Check that the TokTickIT API is running, then try again."
          onRetry={() => void loadTicket()}
        />
      )}

      {load === 'ready' && ticket && (
        <>
          <div className="ttk-staff-detail__columns">
            <Card className="ttk-detail__card">
              <div className="ttk-detail__heading">
                <h2>{ticket.ticketNumber}</h2>
                <StatusBadge status={ticket.currentStatus} />
              </div>

              <dl className="ttk-detail__wide">
                <ReadOnlyField label="Summary">{ticket.summary}</ReadOnlyField>
                <ReadOnlyField label="Description">
                  <span className="ttk-detail__description">{ticket.description}</span>
                </ReadOnlyField>
              </dl>

              <dl className="ttk-detail__grid">
                <ReadOnlyField label="Requester">{ticket.requester.name}</ReadOnlyField>
                <ReadOnlyField label="Category">{ticket.category.name}</ReadOnlyField>
                <ReadOnlyField label="Related System">{ticket.relatedSystem.name}</ReadOnlyField>
                <ReadOnlyField label="Created Date">
                  {formatAbsolute(ticket.createdAt)}
                </ReadOnlyField>
                <ReadOnlyField label="Last Updated">
                  {formatAbsolute(ticket.updatedAt)}
                </ReadOnlyField>
              </dl>
            </Card>

            <section className="ttk-workflow" aria-labelledby="workflow-heading">
              <h2 id="workflow-heading" className="ttk-workflow__title">
                Workflow
              </h2>

              {/* One polite region for every successful save, so a screen
                  reader hears that the change took without focus moving. */}
              <p className="ttk-visually-hidden" role="status">
                {announcement}
              </p>

              {ticket.requesterResolvedAt && (
                <p className="ttk-workflow__signal">
                  The Requester reported this appears resolved on{' '}
                  {formatAbsolute(ticket.requesterResolvedAt)}.
                </p>
              )}

              <div className="ttk-workflow__group">
                <h3 className="ttk-field__label">Ticket Owner</h3>
                <p className="ttk-workflow__current" data-testid="owner-current">
                  {ticket.owner ? ticket.owner.name : 'Unassigned'}
                  {ownedByMe && ' (you)'}
                </p>

                <div className="ttk-workflow__actions">
                  {!ownedByMe && (
                    <Button
                      busy={saving === 'owner'}
                      busyLabel="Saving…"
                      disabled={saving !== null}
                      onClick={() =>
                        void change(
                          'owner',
                          () => setTicketOwner(ticket.id, user.id),
                          () => 'You are now the Ticket Owner.',
                        )
                      }
                    >
                      Claim
                    </Button>
                  )}
                  {ticket.owner && (
                    <Button
                      variant="tertiary"
                      disabled={saving !== null || ticket.ownerRequired}
                      aria-describedby={ticket.ownerRequired ? 'unassign-reason' : undefined}
                      onClick={() =>
                        void change(
                          'owner',
                          () => setTicketOwner(ticket.id, null),
                          () => 'The Ticket is now unassigned.',
                        )
                      }
                    >
                      Unassign
                    </Button>
                  )}
                </div>

                {/* Disabled with the reason beside it, not hidden: a missing
                    button says nothing, and the server would refuse anyway. */}
                {ticket.owner && ticket.ownerRequired && (
                  <p id="unassign-reason" className="ttk-workflow__hint">
                    A {STATUS_LABEL[ticket.currentStatus]} Ticket must keep its Ticket Owner. It
                    can still be reassigned.
                  </p>
                )}

                <Field id="reassign" label="Reassign to">
                  {(attrs) => (
                    <select
                      {...attrs}
                      // Always shows the prompt: this is an action, not a
                      // display of the owner, which is the line above.
                      value=""
                      disabled={saving !== null || undefined}
                      onChange={(event) => {
                        const target = assignable.find(
                          (candidate) => candidate.id === Number(event.target.value),
                        )
                        if (!target) return
                        void change(
                          'owner',
                          () => setTicketOwner(ticket.id, target.id),
                          () => `Ticket Owner is now ${target.name}.`,
                        )
                      }}
                    >
                      <option value="">Choose a colleague…</option>
                      {assignable
                        .filter((candidate) => candidate.id !== ticket.owner?.id)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name} ({ROLE_LABEL[candidate.role] ?? candidate.role})
                          </option>
                        ))}
                    </select>
                  )}
                </Field>
                {errors.owner && (
                  <p className="ttk-field__error" role="alert">
                    {errors.owner}
                  </p>
                )}
              </div>

              <div className="ttk-workflow__group">
                <div className="ttk-workflow__pair">
                  <Field id="it-priority" label="IT Priority">
                    {(attrs) => (
                      <select
                        {...attrs}
                        // Bound to the Ticket, not to a local copy: a save
                        // that fails leaves the select showing what is true.
                        value={ticket.itPriority}
                        disabled={saving !== null || undefined}
                        onChange={(event) => {
                          const itPriority = event.target.value as ItPriority
                          void change(
                            'priority',
                            () => setItPriority(ticket.id, itPriority),
                            () => `IT Priority set to ${IT_PRIORITY_LABEL[itPriority]}.`,
                          )
                        }}
                      >
                        {IT_PRIORITIES.map((priority) => (
                          <option key={priority} value={priority}>
                            {IT_PRIORITY_LABEL[priority]}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <div>
                    <p className="ttk-field__label">Requested Priority</p>
                    <p className="ttk-workflow__readonly" data-testid="requested-priority">
                      <RequestedPriorityBadge priority={ticket.requestedPriority} />
                    </p>
                  </div>
                </div>
                <p className="ttk-workflow__hint">
                  {saving === 'priority' ? (
                    'Saving…'
                  ) : (
                    <>
                      Currently <ItPriorityBadge priority={ticket.itPriority} />. Requested Priority
                      is what the Requester asked for and does not change.
                    </>
                  )}
                </p>
                {errors.priority && (
                  <p className="ttk-field__error" role="alert">
                    {errors.priority}
                  </p>
                )}
              </div>

              <div className="ttk-workflow__group">
                <p className="ttk-field__label">Status</p>
                <p className="ttk-workflow__current">
                  <StatusBadge status={ticket.currentStatus} />
                </p>

                {ticket.transitions.length === 0 ? (
                  <p className="ttk-workflow__hint">
                    {STATUS_LABEL[ticket.currentStatus]} is final. This Ticket cannot be moved again.
                  </p>
                ) : (
                  <>
                    <Field id="next-status" label="Move to">
                      {(attrs) => (
                        <select
                          {...attrs}
                          value={nextStatus}
                          disabled={saving !== null || undefined}
                          onChange={(event) => setNextStatus(event.target.value as TicketStatus | '')}
                        >
                          <option value="">Choose a status…</option>
                          {ticket.transitions.map((move) => (
                            <option
                              key={move.to}
                              value={move.to}
                              disabled={move.requiresOwner && !ticket.owner}
                            >
                              {STATUS_LABEL[move.to]}
                              {move.requiresOwner && !ticket.owner ? ' (needs a Ticket Owner)' : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                    {anyNeedsOwner && (
                      <p className="ttk-workflow__hint">
                        A Ticket needs a Ticket Owner before it can be Resolved or Closed. Claim it
                        or assign it first.
                      </p>
                    )}
                    {/* A separate button, not save-on-change like IT Priority:
                        a priority can be put back, but Cancelled cannot. */}
                    <Button
                      busy={saving === 'status'}
                      busyLabel="Saving…"
                      disabled={!nextStatus || blockedByOwner || saving !== null}
                      onClick={() => {
                        if (!nextStatus) return
                        const target = nextStatus
                        void change(
                          'status',
                          () => setTicketStatus(ticket.id, target),
                          () => `Status changed to ${STATUS_LABEL[target]}.`,
                        )
                      }}
                    >
                      Change status
                    </Button>
                  </>
                )}
                {errors.status && (
                  <p className="ttk-field__error" role="alert">
                    {errors.status}
                  </p>
                )}
              </div>
            </section>
          </div>

          {/* Read-only here (AC-45): staff open and download what the
              Requester attached. Adding and removing stay with the Requester,
              so neither control is rendered. */}
          <Card className="ttk-staff-detail__attachments">
            <h2 className="ttk-thread__title">Attachments</h2>
            {ticket.attachments.length === 0 ? (
              <p className="ttk-thread__empty">No attachments on this Ticket.</p>
            ) : (
              <ul className="ttk-attachments__list">
                {ticket.attachments.map((attachment) => (
                  <li
                    key={attachment.id}
                    className={`ttk-attachments__row${attachment.isRemoved ? ' ttk-attachments__row--removed' : ''}`}
                  >
                    <div className="ttk-attachments__meta">
                      <span className="ttk-attachments__name">{attachment.originalFilename}</span>
                      <span className="ttk-muted">
                        {formatFileSize(attachment.sizeBytes)} ·{' '}
                        {new Date(attachment.createdAt).toLocaleDateString()}
                      </span>
                      {attachment.isRemoved && (
                        <span className="ttk-attachments__removed">
                          <span className="ttk-badge ttk-badge--neutral">Removed</span>
                          {attachment.removedReason && (
                            <span className="ttk-muted"> — {attachment.removedReason}</span>
                          )}
                        </span>
                      )}
                    </div>
                    {!attachment.isRemoved && (
                      <div className="ttk-attachments__actions">
                        <a
                          className="ttk-btn ttk-btn--tertiary"
                          href={attachmentDownloadUrl(attachment.id)}
                        >
                          Download
                        </a>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <CommentThread
            ticketId={ticket.id}
            stream={PUBLIC_STREAM}
            comments={comments.filter((comment) => comment.visibility === 'PUBLIC')}
            failed={commentsFailed}
            onRetry={() => void loadComments()}
            onPosted={(comment) => setComments((previous) => [...previous, comment])}
          />

          <CommentThread
            ticketId={ticket.id}
            stream={INTERNAL_STREAM}
            comments={comments.filter((comment) => comment.visibility === 'INTERNAL')}
            failed={commentsFailed}
            onRetry={() => void loadComments()}
            onPosted={(comment) => setComments((previous) => [...previous, comment])}
          />
        </>
      )}
    </div>
  )
}
