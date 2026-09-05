import { useRef, useState } from 'react'
import {
  ApiError,
  attachmentDownloadUrl,
  removeAttachment,
  uploadAttachment,
} from '../api'
import type { TicketAttachment } from '../api'
import { Button } from './Button'
import { Field } from './Field'
import {
  MAX_ACTIVE_ATTACHMENTS,
  formatFileSize,
  rejectFile,
} from '../pages/createTicketValidation'
import './AttachmentSection.css'

interface AttachmentSectionProps {
  ticketId: number
  requesterId: number
  attachments: TicketAttachment[]
  onChange: (attachments: TicketAttachment[]) => void
}

/**
 * The Ticket Detail attachment panel (ui-spec.md §6.4).
 *
 * Sectioned separately from the read-only header card: this is the one place
 * on the screen that acts, and mixing it into the header would blur the
 * read-only rule AC-17 sets for everything above it.
 */
export function AttachmentSection({
  ticketId,
  requesterId,
  attachments,
  onChange,
}: AttachmentSectionProps) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  // Which attachment is mid-removal, and the reason typed for it. Held per-row
  // so opening one confirmation cannot carry another row's reason.
  const [removingId, setRemovingId] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeCount = attachments.filter((a) => !a.isRemoved).length
  const atCap = activeCount >= MAX_ACTIVE_ATTACHMENTS

  async function handleUpload(file: File) {
    // Same rules as Create Ticket's picker (BR-19/20/21), from the same module
    // so the two screens cannot drift apart.
    const rejection = rejectFile(file)
    if (rejection) {
      setUploadError(rejection)
      return
    }
    if (atCap) {
      setUploadError(
        `This Ticket already has the maximum of ${MAX_ACTIVE_ATTACHMENTS} attachments.`,
      )
      return
    }

    setUploading(true)
    setUploadError(null)
    try {
      const created = await uploadAttachment(ticketId, requesterId, file)
      // api-spec.md §7's 201 body has no removal fields, since a fresh upload
      // cannot be removed. Filled in here so the list stays one shape rather
      // than widening the response contract to carry two always-null columns.
      onChange([...attachments, { ...created, removedAt: null, removedReason: null }])
    } catch (error) {
      setUploadError(
        error instanceof ApiError ? error.message : `Unable to upload ${file.name}`,
      )
    } finally {
      setUploading(false)
    }
  }

  function openRemoval(id: number) {
    setRemovingId(id)
    setReason('')
    setReasonError(null)
  }

  async function confirmRemoval(id: number) {
    // AC-22: blocked client-side before any request, and re-checked server-side.
    if (reason.trim().length < 3) {
      setReasonError('A removal reason of at least 3 characters is required.')
      return
    }

    setBusyId(id)
    try {
      const removed = await removeAttachment(id, requesterId, reason.trim())
      // AC-20: the row stays, now marked removed — it is not dropped.
      onChange(attachments.map((a) => (a.id === id ? removed : a)))
      setRemovingId(null)
      setReason('')
    } catch (error) {
      setReasonError(
        error instanceof ApiError ? error.message : 'Unable to remove the Attachment',
      )
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="ttk-attachments" aria-labelledby="attachments-heading">
      <h3 id="attachments-heading">Attachments</h3>

      <div className="ttk-attachments__add">
        <label className="ttk-field__label" htmlFor="add-attachment">
          Add an attachment
        </label>
        <input
          ref={fileInputRef}
          id="add-attachment"
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
          disabled={uploading || atCap}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void handleUpload(file)
          }}
        />
        <p className="ttk-attachments__hint">
          {atCap
            ? `This Ticket has the maximum of ${MAX_ACTIVE_ATTACHMENTS} active attachments. Remove one to add another.`
            : `Up to ${MAX_ACTIVE_ATTACHMENTS} files, 5 MB each. JPG, JPEG, PNG, WEBP or PDF.`}
        </p>
        {uploading && <p className="ttk-attachments__hint">Uploading…</p>}
        {uploadError && (
          <p className="ttk-field__error" role="alert">
            {uploadError}
          </p>
        )}
      </div>

      {attachments.length === 0 ? (
        <p className="ttk-attachments__empty">No attachments on this Ticket.</p>
      ) : (
        <ul className="ttk-attachments__list">
          {attachments.map((attachment) => (
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

              {/* BR-24/AC-20: a removed Attachment has no Download at all,
                  rather than a disabled one — the action does not exist for
                  it, and the server would 404 anyway (BR-26). */}
              {!attachment.isRemoved && (
                <div className="ttk-attachments__actions">
                  <a
                    className="ttk-btn ttk-btn--tertiary"
                    href={attachmentDownloadUrl(attachment.id, requesterId)}
                  >
                    Download
                  </a>
                  <Button
                    variant="destructive"
                    onClick={() => openRemoval(attachment.id)}
                  >
                    Remove
                  </Button>
                </div>
              )}

              {removingId === attachment.id && (
                <div className="ttk-attachments__confirm">
                  <Field
                    id={`remove-reason-${attachment.id}`}
                    label="Reason for removal"
                    required
                    error={reasonError ?? undefined}
                  >
                    {(attrs) => (
                      <input
                        {...attrs}
                        type="text"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    )}
                  </Field>
                  <div className="ttk-attachments__confirm-actions">
                    <Button
                      variant="secondary"
                      onClick={() => setRemovingId(null)}
                      disabled={busyId === attachment.id}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      busy={busyId === attachment.id}
                      busyLabel="Removing…"
                      onClick={() => void confirmRemoval(attachment.id)}
                    >
                      Confirm removal
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
