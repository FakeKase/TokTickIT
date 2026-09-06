import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ApiError,
  createTicket,
  fetchCategories,
  fetchRelatedSystems,
  uploadAttachment,
} from '../api'
import type { Category, RelatedSystem, RequestedPriority, Ticket } from '../api'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ErrorState } from '../components/ErrorState'
import { Field } from '../components/Field'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useSelectedRequester } from '../requester/useSelectedRequester'
import {
  DESCRIPTION_MAX,
  MAX_ACTIVE_ATTACHMENTS,
  SUMMARY_MAX,
  emptyTicketForm,
  formatFileSize,
  rejectFile,
  validateTicketForm,
} from './createTicketValidation'
import type { TicketFormErrors, TicketFormValues } from './createTicketValidation'
import './CreateTicketPage.css'

type RefData =
  | { status: 'loading' }
  | { status: 'ready'; categories: Category[]; relatedSystems: RelatedSystem[] }
  | { status: 'failed' }

interface QueuedFile {
  id: string
  file: File
  /** Set once the Ticket exists and this file's upload failed (BR-22). */
  error?: string
  uploaded?: boolean
}

const PRIORITIES: { value: RequestedPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
]

/**
 * Create Ticket (ui-spec.md §6.2). States run initial -> validating ->
 * submitting -> success | failure, with entered values always retained on
 * failure per BR-18.
 */
export function CreateTicketPage() {
  const { requester } = useSelectedRequester()
  const navigate = useNavigate()

  const [refData, setRefData] = useState<RefData>({ status: 'loading' })
  const [values, setValues] = useState<TicketFormValues>(emptyTicketForm)
  const [errors, setErrors] = useState<TicketFormErrors>({})
  const [showErrors, setShowErrors] = useState(false)
  const [files, setFiles] = useState<QueuedFile[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [created, setCreated] = useState<Ticket | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadReferenceData = useCallback(async () => {
    setRefData({ status: 'loading' })
    try {
      const [categories, relatedSystems] = await Promise.all([
        fetchCategories(),
        fetchRelatedSystems(),
      ])
      setRefData({ status: 'ready', categories, relatedSystems })
    } catch {
      setRefData({ status: 'failed' })
    }
  }, [])

  useEffect(() => {
    void loadReferenceData()
  }, [loadReferenceData])

  function update<K extends keyof TicketFormValues>(key: K, value: TicketFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
    // Clear a server-supplied message for this field as soon as it is edited.
    setErrors((prev) => (key in prev ? { ...prev, [key]: undefined } : prev))
  }

  function addFiles(incoming: File[]) {
    if (incoming.length === 0) return

    const accepted: QueuedFile[] = []
    let rejection: string | null = null

    for (const file of incoming) {
      if (files.length + accepted.length >= MAX_ACTIVE_ATTACHMENTS) {
        rejection = `A Ticket may have at most ${MAX_ACTIVE_ATTACHMENTS} attachments.`
        break
      }
      const reason = rejectFile(file)
      if (reason) {
        // AC-08/AC-09: rejected inline, and never queued for upload.
        rejection = reason
        continue
      }
      accepted.push({ id: `${file.name}-${file.size}-${crypto.randomUUID()}`, file })
    }

    setFileError(rejection)
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted])
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id))
    setFileError(null)
  }

  async function uploadOne(ticketId: number, queued: QueuedFile) {
    try {
      await uploadAttachment(ticketId, requester!.id, queued.file)
      setFiles((prev) =>
        prev.map((f) => (f.id === queued.id ? { ...f, uploaded: true, error: undefined } : f)),
      )
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : `Unable to upload ${queued.file.name}`
      setFiles((prev) => prev.map((f) => (f.id === queued.id ? { ...f, error: message } : f)))
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    // BR-17: ignore repeat submits while one is in flight.
    if (submitting || created) return

    const validation = validateTicketForm(values)
    setErrors(validation)
    setShowErrors(true)
    // AC-04/AC-05: no request is made at all while the form is invalid.
    if (Object.keys(validation).length > 0) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const ticket = await createTicket({
        requesterId: requester!.id,
        categoryId: Number(values.categoryId),
        relatedSystemId: Number(values.relatedSystemId),
        requestedPriority: values.requestedPriority as RequestedPriority,
        summary: values.summary.trim(),
        description: values.description.trim(),
      })
      setCreated(ticket)

      // BR-22: the Ticket is already saved. Attachment failures are reported
      // per file and retried from here; none of them undoes the Ticket.
      for (const queued of files) {
        await uploadOne(ticket.id, queued)
      }
    } catch (error) {
      // BR-18/AC-07: values stay on screen, and any field messages the server
      // sent land under their own control rather than only in the banner.
      if (error instanceof ApiError) {
        setSubmitError(error.message)
        if (Object.keys(error.fields).length > 0) {
          setErrors((prev) => ({ ...prev, ...error.fields }))
        }
      } else {
        setSubmitError('Unable to reach the TokTickIT API. Your entries have been kept.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  function startAnother() {
    setValues(emptyTicketForm())
    setErrors({})
    setShowErrors(false)
    setFiles([])
    setFileError(null)
    setSubmitError(null)
    setCreated(null)
  }

  function fieldError(key: keyof TicketFormValues) {
    return showErrors ? errors[key] : undefined
  }

  if (!requester) return null

  if (created) {
    const failed = files.filter((f) => f.error)

    return (
      <div className="ttk-create-ticket">
        <Card className="ttk-create-ticket__success">
          <h2>Ticket created</h2>
          <p className="ttk-create-ticket__number-label">Your Ticket Number</p>
          <p className="ttk-create-ticket__number">{created.ticketNumber}</p>

          {failed.length > 0 && (
            <div className="ttk-create-ticket__upload-failures" role="alert">
              <strong>
                The Ticket was saved, but {failed.length} attachment
                {failed.length > 1 ? 's' : ''} could not be uploaded.
              </strong>
              <ul>
                {failed.map((f) => (
                  <li key={f.id}>
                    {f.file.name} — {f.error}{' '}
                    <Button
                      variant="tertiary"
                      onClick={() => void uploadOne(created.id, f)}
                    >
                      Retry
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="ttk-create-ticket__success-actions">
            <Button onClick={() => navigate(`/tickets/${created.id}`)}>View Ticket</Button>
            <Button variant="secondary" onClick={startAnother}>
              Create Another
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="ttk-create-ticket">
      <Card>
        <h2>Create Ticket</h2>

        {submitError && (
          <ErrorState
            title="The Ticket was not created"
            message={submitError}
            className="ttk-create-ticket__banner"
          />
        )}

        {refData.status === 'loading' && <LoadingSpinner label="Loading form options…" />}

        {refData.status === 'failed' && (
          <ErrorState
            title="Unable to load the form"
            message="Category and Related System options could not be loaded. Check that the TokTickIT API is running, then try again."
            onRetry={() => void loadReferenceData()}
          />
        )}

        {refData.status === 'ready' && (
          <form onSubmit={handleSubmit} noValidate>
            {/* 1. System-generated row (ui-spec.md §6.2). */}
            <div className="ttk-create-ticket__row">
              <Field id="ticket-date" label="Ticket Date" readOnly>
                {(attrs) => <input {...attrs} value="Will be set on save" readOnly />}
              </Field>
              <Field id="ticket-requester" label="Requester" readOnly>
                {(attrs) => <input {...attrs} value={requester.name} readOnly />}
              </Field>
            </div>

            {/* 2. Classification row. */}
            <div className="ttk-create-ticket__row ttk-create-ticket__row--three">
              <Field id="category" label="Category" required error={fieldError('categoryId')}>
                {(attrs) => (
                  <select
                    {...attrs}
                    value={values.categoryId}
                    onChange={(e) => update('categoryId', e.target.value)}
                    disabled={submitting}
                  >
                    <option value="">Select a Category…</option>
                    {refData.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <Field
                id="related-system"
                label="Related System"
                required
                error={fieldError('relatedSystemId')}
              >
                {(attrs) => (
                  <select
                    {...attrs}
                    value={values.relatedSystemId}
                    onChange={(e) => update('relatedSystemId', e.target.value)}
                    disabled={submitting}
                  >
                    <option value="">Select a Related System…</option>
                    {refData.relatedSystems.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <Field
                id="requested-priority"
                label="Requested Priority"
                required
                error={fieldError('requestedPriority')}
              >
                {(attrs) => (
                  <select
                    {...attrs}
                    value={values.requestedPriority}
                    onChange={(e) =>
                      update('requestedPriority', e.target.value as RequestedPriority)
                    }
                    disabled={submitting}
                  >
                    <option value="">Select a Priority…</option>
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>

            {/* 3. Summary. */}
            <Field
              id="summary"
              label="Summary"
              required
              error={fieldError('summary')}
              hint={`${values.summary.trim().length} / ${SUMMARY_MAX}`}
            >
              {(attrs) => (
                <input
                  {...attrs}
                  type="text"
                  value={values.summary}
                  onChange={(e) => update('summary', e.target.value)}
                  disabled={submitting}
                />
              )}
            </Field>

            {/* 4. Description. */}
            <Field
              id="description"
              label="Description"
              required
              error={fieldError('description')}
              hint={`${values.description.trim().length} / ${DESCRIPTION_MAX}`}
            >
              {(attrs) => (
                <textarea
                  {...attrs}
                  rows={6}
                  value={values.description}
                  onChange={(e) => update('description', e.target.value)}
                  disabled={submitting}
                />
              )}
            </Field>

            {/* 5. Attachments. */}
            <fieldset className="ttk-create-ticket__attachments" disabled={submitting}>
              <legend>Attachments</legend>
              <p className="ttk-create-ticket__attachments-hint">
                Up to {MAX_ACTIVE_ATTACHMENTS} files, 5 MB each. JPG, JPEG, PNG, WEBP or PDF.
              </p>

              {/* A <legend> names the group, not the control — the input needs
                  its own label or it reaches assistive tech unnamed. */}
              <label className="ttk-field__label" htmlFor="attachments">
                Add files
              </label>
              <input
                ref={fileInputRef}
                id="attachments"
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []))
                  // Reset so re-picking the same file still fires a change.
                  e.target.value = ''
                }}
              />

              {fileError && (
                <p className="ttk-field__error" role="alert">
                  {fileError}
                </p>
              )}

              {files.length > 0 && (
                <ul className="ttk-create-ticket__file-list">
                  {files.map((f) => (
                    <li key={f.id}>
                      <span>
                        {f.file.name} <span className="ttk-muted">({formatFileSize(f.file.size)})</span>
                      </span>
                      <Button
                        variant="tertiary"
                        onClick={() => removeFile(f.id)}
                        aria-label={`Remove ${f.file.name}`}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>

            {/* 6. Actions. */}
            <div className="ttk-create-ticket__actions">
              <Button variant="secondary" onClick={() => navigate('/tickets')} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" busy={submitting} busyLabel="Creating Ticket…">
                Create Ticket
              </Button>
            </div>
          </form>
        )}
      </Card>

      <p className="ttk-create-ticket__foot">
        <Link to="/tickets">Back to My Tickets</Link>
      </p>
    </div>
  )
}
