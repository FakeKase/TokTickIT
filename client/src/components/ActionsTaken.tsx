import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, createAction, fetchActions, updateAction } from '../api'
import type { ActionTaken, TicketStatus } from '../api'
import {
  ACTION_DESCRIPTION_MAX,
  ACTION_FIELD_ORDER,
  ACTION_RESULT_MAX,
  ATTACHMENT_NOTES_MAX,
  FOLLOW_UP_NOTE_MAX,
  actionFormFrom,
  emptyActionForm,
  toActionInput,
  validateActionForm,
} from '../pages/actionValidation'
import type { ActionFormErrors, ActionFormValues } from '../pages/actionValidation'
import { formatAbsolute } from '../pages/relativeTime'
import { Badge } from './Badge'
import { Button } from './Button'
import { Card } from './Card'
import { Dialog } from './Dialog'
import { ErrorState } from './ErrorState'
import { Field } from './Field'
import { LoadingSpinner } from './LoadingSpinner'
import { STATUS_LABEL } from './ticketLabels'
// The section heading and the read-only value box are the ones the
// conversation and the Ticket card use, so their styles are loaded here too
// rather than assumed to have been loaded by whichever page this sits on.
import './CommentThread.css'
import '../pages/TicketDetailPage.css'
import './ActionsTaken.css'

/** BR-22: the statuses in which work can still be recorded. The server
 *  decides; this only chooses between offering the button and explaining why
 *  it is not there. */
const ACTIVE: readonly TicketStatus[] = [
  'NEW',
  'OPEN',
  'IN_PROGRESS',
  'WAITING_FOR_REQUESTER',
  'REOPENED',
]

type Load = 'loading' | 'ready' | 'failed'

type Open =
  | { mode: 'create' }
  | { mode: 'view'; action: ActionTaken }
  | { mode: 'edit'; action: ActionTaken }

/** One per form, sent with every attempt (BR-20). `randomUUID` exists only
 *  in a secure context, so a page served over plain http on a LAN address
 *  falls back to something that is merely unique enough. */
function newRequestKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  )
}

/** Follow-up in words, never by colour alone (ui-spec.md §6.1). */
function FollowUpBadge({ required }: { required: boolean }) {
  return required ? (
    <Badge tone="warning">Follow-up required</Badge>
  ) : (
    <Badge>No follow-up</Badge>
  )
}

function EditedMark({ action }: { action: ActionTaken }) {
  if (!action.editedBy || !action.editedAt) return null
  return (
    <span className="ttk-actions__edited">
      Edited by {action.editedBy.name}, {formatAbsolute(action.editedAt)}
    </span>
  )
}

export interface ActionsTakenProps {
  ticketId: number
  ticketStatus: TicketStatus
  /** The lower bound for Action Date/Time (BR-05). */
  ticketCreatedAt: string
  /** IT Staff and Administrators record and edit; a Requester only reads. The
   *  server enforces this whatever is passed here. */
  canWrite: boolean
  /** Shown as Performed by while creating. */
  currentUserName: string
  /** Called after a save, and when the server says the Ticket has moved on,
   *  so the page can bring the Ticket itself up to date. */
  onTicketChanged?: () => void
  /** Where a successful save is announced. A page that already has a polite
   *  region passes its own, so the page keeps a single one; without it this
   *  section announces for itself. */
  onAnnounce?: (message: string) => void
}

/**
 * The Actions Taken area of a Ticket (Lab 4 ui-spec.md §6; FR-01 to FR-04).
 *
 * Loaded apart from the Ticket, like the conversation: this endpoint having a
 * bad minute must not take a good Ticket down with it.
 */
export function ActionsTaken({
  ticketId,
  ticketStatus,
  ticketCreatedAt,
  canWrite,
  currentUserName,
  onTicketChanged,
  onAnnounce,
}: ActionsTakenProps) {
  const [load, setLoad] = useState<Load>('loading')
  const [actions, setActions] = useState<ActionTaken[]>([])
  const [open, setOpen] = useState<Open | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const loadActions = useCallback(
    async (isCurrent: () => boolean = () => true, quiet = false) => {
      if (!quiet) setLoad('loading')
      try {
        const loaded = await fetchActions(ticketId)
        if (!isCurrent()) return
        setActions(loaded)
        setLoad('ready')
      } catch {
        if (isCurrent()) setLoad('failed')
      }
    },
    [ticketId],
  )

  useEffect(() => {
    let current = true
    void loadActions(() => current)
    return () => {
      current = false
    }
  }, [loadActions])

  const active = ACTIVE.includes(ticketStatus)
  const mayWrite = canWrite && active

  const viewLabel = (action: ActionTaken) =>
    `View the Action Taken by ${action.performedBy.name} on ${formatAbsolute(action.actionAt)}`

  // A link from the dashboard names this area (`#actions-taken`). The browser
  // only scrolls to a fragment that exists when the page loads, and this one
  // is drawn after the Ticket arrives, so it is brought into view here.
  useEffect(() => {
    if (window.location.hash !== '#actions-taken') return
    document.getElementById('actions-taken')?.scrollIntoView?.()
  }, [])

  return (
    <Card id="actions-taken" className="ttk-actions">
      <div className="ttk-actions__head">
        <div>
          <h2 className="ttk-thread__title">Actions Taken</h2>
          <p className="ttk-thread__note">
            {canWrite
              ? 'Work recorded on this Ticket. Visible to the Requester.'
              : 'Work IT Staff have recorded on your Ticket.'}
          </p>
        </div>
        {mayWrite && load === 'ready' && (
          <Button onClick={() => setOpen({ mode: 'create' })}>Add Action Taken</Button>
        )}
      </div>

      {canWrite && !onAnnounce && (
        <p className="ttk-visually-hidden" role="status">
          {announcement}
        </p>
      )}

      {canWrite && !active && (
        <p className="ttk-actions__frozen">
          This Ticket is {STATUS_LABEL[ticketStatus]}. Reopen it to record more work.
        </p>
      )}

      {load === 'loading' && <LoadingSpinner label="Loading the Actions Taken…" />}

      {load === 'failed' && (
        <ErrorState
          title="Unable to load the Actions Taken"
          message="The rest of the Ticket is unaffected."
          retryLabel="Try again"
          onRetry={() => void loadActions()}
        />
      )}

      {load === 'ready' && actions.length === 0 && (
        <p className="ttk-thread__empty">
          No Actions Taken have been recorded for this Ticket yet.
        </p>
      )}

      {load === 'ready' && actions.length > 0 && (
        <>
          <p className="ttk-actions__count">
            {actions.length === 1 ? '1 Action Taken' : `${actions.length} Actions Taken`}
          </p>

          {/* Table at 768px and above, the same rows as cards below it. Both
              are rendered and a media query hides one, as on My Tickets. */}
          <div className="ttk-actions__table-wrap">
            <table className="ttk-actions__table">
              <caption className="ttk-visually-hidden">
                Actions Taken on this Ticket, newest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Action Date/Time</th>
                  <th scope="col">Action Description</th>
                  <th scope="col">Result</th>
                  <th scope="col">Performed by</th>
                  <th scope="col">Follow-up</th>
                  <th scope="col">
                    <span className="ttk-visually-hidden">View</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {actions.map((action) => (
                  <tr key={action.id}>
                    <td className="ttk-actions__when">{formatAbsolute(action.actionAt)}</td>
                    <td>
                      <span className="ttk-actions__clamp">{action.description}</span>
                    </td>
                    <td>
                      <span className="ttk-actions__clamp">{action.result}</span>
                    </td>
                    <td>
                      {action.performedBy.name}
                      <EditedMark action={action} />
                    </td>
                    <td>
                      <FollowUpBadge required={action.followUpRequired} />
                    </td>
                    <td className="ttk-actions__open">
                      <Button
                        variant="secondary"
                        aria-label={viewLabel(action)}
                        onClick={() => setOpen({ mode: 'view', action })}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="ttk-actions__cards">
            {actions.map((action) => (
              <li key={action.id} className="ttk-actions__card">
                <p className="ttk-actions__card-head">
                  <span className="ttk-actions__when">{formatAbsolute(action.actionAt)}</span>
                  <span>{action.performedBy.name}</span>
                </p>
                <EditedMark action={action} />
                <p className="ttk-field__label">Action Description</p>
                <p className="ttk-actions__clamp">{action.description}</p>
                <p className="ttk-field__label">Result</p>
                <p className="ttk-actions__clamp">{action.result}</p>
                <p>
                  <FollowUpBadge required={action.followUpRequired} />
                </p>
                <Button
                  variant="secondary"
                  aria-label={viewLabel(action)}
                  onClick={() => setOpen({ mode: 'view', action })}
                >
                  View
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      {open && (
        <ActionDialog
          // A new key per opening and per mode, so the form's state, and the
          // request key with it, never survives into a different action.
          key={open.mode === 'create' ? 'create' : `${open.mode}-${open.action.id}`}
          open={open}
          ticketId={ticketId}
          ticketCreatedAt={ticketCreatedAt}
          mayEdit={mayWrite}
          currentUserName={currentUserName}
          onClose={() => setOpen(null)}
          onEdit={(action) => setOpen({ mode: 'edit', action })}
          onSaved={(message) => {
            setOpen(null)
            if (onAnnounce) onAnnounce(message)
            else setAnnouncement(message)
            void loadActions(undefined, true)
            onTicketChanged?.()
          }}
          onTicketMoved={() => onTicketChanged?.()}
        />
      )}
    </Card>
  )
}

const FIELD_ID: Record<keyof ActionFormValues, string> = {
  actionAt: 'action-at',
  description: 'action-description',
  result: 'action-result',
  followUpRequired: 'action-follow-up',
  followUpNote: 'action-follow-up-note',
  attachmentNotes: 'action-attachment-notes',
}

const DIALOG_TITLE = {
  create: 'Add Action Taken',
  view: 'Action Taken',
  edit: 'Edit Action Taken',
}

function ReadOnly({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ttk-detail__field">
      <dt className="ttk-field__label">{label}</dt>
      <dd className="ttk-detail__value ttk-actions__text">{children}</dd>
    </div>
  )
}

/**
 * One dialog, three modes (ui-spec.md §6.3). View holds no input at all; the
 * other two hold the same form.
 */
function ActionDialog({
  open,
  ticketId,
  ticketCreatedAt,
  mayEdit,
  currentUserName,
  onClose,
  onEdit,
  onSaved,
  onTicketMoved,
}: {
  open: Open
  ticketId: number
  ticketCreatedAt: string
  mayEdit: boolean
  currentUserName: string
  onClose: () => void
  onEdit: (action: ActionTaken) => void
  onSaved: (message: string) => void
  onTicketMoved: () => void
}) {
  const editing = open.mode === 'edit' ? open.action : null

  const [form, setForm] = useState<ActionFormValues>(() =>
    editing ? actionFormFrom(editing) : emptyActionForm(),
  )
  const [errors, setErrors] = useState<ActionFormErrors>({})
  const [alert, setAlert] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Chosen once when the dialog opens and reused for every attempt, so
  // pressing Save again after a lost response cannot create a second row.
  const [requestKey] = useState(newRequestKey)
  // The version an edit is based on. It moves only when the person chooses
  // to continue from the row a colleague saved.
  const [baseVersion, setBaseVersion] = useState(editing?.version ?? 0)
  // The row the form was last filled from. Its Action Date/Time is sent back
  // as it is when the field has not been touched: the form holds minutes
  // only, so sending the field's own value would quietly move an action
  // recorded with seconds to the start of its minute.
  const [filledFrom, setFilledFrom] = useState<ActionTaken | null>(editing)
  // The row as a colleague left it, while this form waits for a decision.
  const [theirs, setTheirs] = useState<ActionTaken | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  if (open.mode === 'view') {
    const action = open.action
    return (
      <Dialog title={DIALOG_TITLE.view} onClose={onClose}>
        <dl className="ttk-actions__view">
          <ReadOnly label="Action Date/Time">{formatAbsolute(action.actionAt)}</ReadOnly>
          <ReadOnly label="Action Description">{action.description}</ReadOnly>
          <ReadOnly label="Result">{action.result}</ReadOnly>
          <ReadOnly label="Performed by">{action.performedBy.name}</ReadOnly>
          <ReadOnly label="Follow-Up Required?">
            <FollowUpBadge required={action.followUpRequired} />
          </ReadOnly>
          <ReadOnly label="Follow-up Note">{action.followUpNote ?? 'None'}</ReadOnly>
          <ReadOnly label="Attachment Notes">{action.attachmentNotes ?? 'None'}</ReadOnly>
          <ReadOnly label="Recorded">{formatAbsolute(action.createdAt)}</ReadOnly>
          {action.editedBy && action.editedAt && (
            <ReadOnly label="Edited by">
              {action.editedBy.name}, {formatAbsolute(action.editedAt)}
            </ReadOnly>
          )}
        </dl>
        <div className="ttk-actions__buttons">
          {mayEdit && <Button onClick={() => onEdit(action)}>Edit</Button>}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </Dialog>
    )
  }

  const set = <K extends keyof ActionFormValues>(key: K, value: ActionFormValues[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => ({ ...previous, [key]: undefined }))
  }

  /** Puts the messages on their fields and focus on the first one. */
  function showFieldErrors(problems: ActionFormErrors) {
    setErrors(problems)
    const first = ACTION_FIELD_ORDER.find((field) => problems[field])
    if (!first) return
    // After the render that draws the message, so the field's
    // aria-describedby already points at it when focus arrives.
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>(`#${FIELD_ID[first]}`)?.focus()
    })
  }

  async function save(version: number) {
    if (saving) return

    const problems = validateActionForm(form, { ticketCreatedAt })
    setAlert(null)
    if (Object.keys(problems).length > 0) {
      showFieldErrors(problems)
      return
    }
    setErrors({})

    setSaving(true)
    try {
      const input = toActionInput(form)
      if (filledFrom && form.actionAt === actionFormFrom(filledFrom).actionAt) {
        input.actionAt = filledFrom.actionAt
      }
      if (editing) {
        await updateAction(ticketId, editing.id, version, input)
        onSaved('Action Taken updated.')
      } else {
        await createAction(ticketId, requestKey, input)
        onSaved('Action Taken recorded.')
      }
    } catch (failure) {
      // Whatever went wrong, the form keeps what was typed (BR-31).
      const refusal = failure instanceof ApiError ? failure : null
      if (refusal?.status === 400 && Object.keys(refusal.fields).length > 0) {
        showFieldErrors(refusal.fields as ActionFormErrors)
      } else if (refusal?.code === 'STALE_ACTION' && refusal.body.current) {
        setTheirs(refusal.body.current as ActionTaken)
      } else if (refusal?.code === 'TICKET_NOT_ACTIVE') {
        // The server's sentence names the status the Ticket has reached.
        setAlert(refusal.message)
        onTicketMoved()
      } else if (refusal?.status === 409) {
        setAlert(refusal.message)
      } else {
        setAlert('Unable to save the Action Taken. Your text is still here. Try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void save(baseVersion)
  }

  const text = (
    key: 'description' | 'result' | 'followUpNote',
    label: string,
    max: number,
    rows: number,
  ) => (
    <Field id={FIELD_ID[key]} label={label} required error={errors[key]}>
      {(attrs) => (
        <>
          <textarea
            {...attrs}
            rows={rows}
            value={form[key]}
            onChange={(event) => set(key, event.target.value)}
          />
          <p className="ttk-actions__counter">
            {form[key].trim().length} / {max}
          </p>
        </>
      )}
    </Field>
  )

  return (
    <Dialog
      title={DIALOG_TITLE[open.mode]}
      // Not while a save is in flight. Cancel is disabled then, but Esc is a
      // second way out, and a dialog that closed under a save that then
      // failed would take the typed text and the error with it (BR-31). It
      // would also throw away the request key, so saving again from a fresh
      // dialog could record the same work twice.
      onClose={() => {
        if (!saving) onClose()
      }}
    >
      <form ref={formRef} className="ttk-actions__form" onSubmit={handleSubmit} noValidate>
        {theirs && (
          <div className="ttk-actions__conflict" role="alert">
            <p>
              {theirs.editedBy?.name ?? 'Someone'} changed this Action Taken while you were
              editing. Your text is still here.
            </p>
            <div className="ttk-actions__buttons">
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => {
                  // Continue from their row, keeping what is typed here.
                  setBaseVersion(theirs.version)
                  setTheirs(null)
                  void save(theirs.version)
                }}
              >
                Save my version
              </Button>
              <Button
                variant="tertiary"
                disabled={saving}
                onClick={() => {
                  setForm(actionFormFrom(theirs))
                  setFilledFrom(theirs)
                  setBaseVersion(theirs.version)
                  setErrors({})
                  setTheirs(null)
                }}
              >
                Discard my changes
              </Button>
            </div>
          </div>
        )}

        {alert && (
          <p className="ttk-field__error" role="alert">
            {alert}
          </p>
        )}

        <Field
          id={FIELD_ID.actionAt}
          label="Action Date/Time"
          required
          hint="When the work was done."
          error={errors.actionAt}
        >
          {(attrs) => (
            <input
              {...attrs}
              type="datetime-local"
              value={form.actionAt}
              onChange={(event) => set('actionAt', event.target.value)}
            />
          )}
        </Field>

        {text('description', 'Action Description', ACTION_DESCRIPTION_MAX, 4)}
        {text('result', 'Result', ACTION_RESULT_MAX, 3)}

        <div className="ttk-actions__group">
          <label className="ttk-actions__choice">
            <input
              id={FIELD_ID.followUpRequired}
              type="checkbox"
              checked={form.followUpRequired}
              onChange={(event) => set('followUpRequired', event.target.checked)}
            />
            Follow-Up Required?
          </label>
        </div>

        {/* Present only while the box is ticked. Unticking hides it, and what
            it held is neither validated nor sent. */}
        {form.followUpRequired && text('followUpNote', 'Follow-up Note', FOLLOW_UP_NOTE_MAX, 3)}

        <Field
          id={FIELD_ID.attachmentNotes}
          label="Attachment Notes"
          hint="Which file to look for, such as a photo or log. Files are not uploaded here."
          error={errors.attachmentNotes}
        >
          {(attrs) => (
            <input
              {...attrs}
              type="text"
              maxLength={ATTACHMENT_NOTES_MAX}
              value={form.attachmentNotes}
              onChange={(event) => set('attachmentNotes', event.target.value)}
            />
          )}
        </Field>

        {/* Text, not a field: nobody chooses who performed an action. */}
        <dl className="ttk-actions__performer">
          <ReadOnly label="Performed by">
            {editing ? `${editing.performedBy.name}. Cannot be changed.` : `${currentUserName} (you)`}
          </ReadOnly>
        </dl>

        <div className="ttk-actions__buttons">
          <Button type="submit" busy={saving} busyLabel="Saving…">
            {editing ? 'Save changes' : 'Save Action Taken'}
          </Button>
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
