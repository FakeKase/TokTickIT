import type { RequestedPriority } from '../api'

/**
 * Client-side mirror of the server's Create Ticket rules (BR-13/14/15) and
 * attachment rules (BR-19/20/21).
 *
 * BR-16 is explicit that this is for immediate feedback only and the backend
 * stays the source of truth — nothing here is a security check, and the server
 * re-validates every one of these. The bounds are duplicated rather than
 * imported because client and server are separate packages; the API tests pin
 * the same numbers on the other side.
 */

export const SUMMARY_MIN = 5
export const SUMMARY_MAX = 120
export const DESCRIPTION_MIN = 10
export const DESCRIPTION_MAX = 2000

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_ACTIVE_ATTACHMENTS = 5
export const ALLOWED_TYPES_LABEL = 'JPG, JPEG, PNG, WEBP or PDF'

const ALLOWED_MIME_TYPES: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
}

export interface TicketFormValues {
  categoryId: string
  relatedSystemId: string
  requestedPriority: RequestedPriority | ''
  summary: string
  description: string
}

export type TicketFormErrors = Partial<Record<keyof TicketFormValues, string>>

export function emptyTicketForm(): TicketFormValues {
  return {
    categoryId: '',
    relatedSystemId: '',
    requestedPriority: '',
    summary: '',
    description: '',
  }
}

export function validateTicketForm(values: TicketFormValues): TicketFormErrors {
  const errors: TicketFormErrors = {}

  if (!values.categoryId) errors.categoryId = 'Category is required.'
  if (!values.relatedSystemId) errors.relatedSystemId = 'Related System is required.'
  if (!values.requestedPriority) {
    errors.requestedPriority = 'Requested Priority is required.'
  }

  // Length is measured after trimming, matching BR-13/BR-14, so padding
  // cannot carry a too-short value past the check.
  const summary = values.summary.trim()
  if (!summary) errors.summary = 'Summary is required.'
  else if (summary.length < SUMMARY_MIN) {
    errors.summary = `Summary must be at least ${SUMMARY_MIN} characters.`
  } else if (summary.length > SUMMARY_MAX) {
    errors.summary = `Summary must be at most ${SUMMARY_MAX} characters.`
  }

  const description = values.description.trim()
  if (!description) errors.description = 'Description is required.'
  else if (description.length < DESCRIPTION_MIN) {
    errors.description = `Description must be at least ${DESCRIPTION_MIN} characters.`
  } else if (description.length > DESCRIPTION_MAX) {
    errors.description = `Description must be at most ${DESCRIPTION_MAX} characters.`
  }

  return errors
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Why a file was refused, or null when it is acceptable. */
export function rejectFile(file: File): string | null {
  const extensions = ALLOWED_MIME_TYPES[file.type]
  const lastDot = file.name.lastIndexOf('.')
  const extension = lastDot > 0 ? file.name.slice(lastDot + 1).toLowerCase() : ''

  if (!extensions || !extensions.includes(extension)) {
    return `${file.name} is not a permitted type. Allowed: ${ALLOWED_TYPES_LABEL}.`
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name} is larger than 5 MB.`
  }
  return null
}
