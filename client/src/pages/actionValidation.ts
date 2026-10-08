import type { ActionTaken, ActionTakenInput } from '../api'

/**
 * Client-side mirror of the server's Action Taken rules (Lab 4 BR-05 to
 * BR-07), for immediate feedback only. The server checks every one of these
 * again and remains the authority. The bounds are duplicated rather than
 * imported because client and server are separate packages; the server's own
 * tests pin the same numbers on the other side.
 */

export const ACTION_DESCRIPTION_MAX = 2000
export const ACTION_RESULT_MAX = 1000
export const FOLLOW_UP_NOTE_MAX = 1000
export const ATTACHMENT_NOTES_MAX = 500

const MINUTE = 60_000
/** How far ahead of now the server still accepts (BR-05). */
const FUTURE_TOLERANCE = 5 * MINUTE

/** What the form holds. `actionAt` is the `datetime-local` text, in the
 *  browser's own zone and to the minute. */
export interface ActionFormValues {
  actionAt: string
  description: string
  result: string
  followUpRequired: boolean
  followUpNote: string
  attachmentNotes: string
}

export type ActionFormErrors = Partial<Record<keyof ActionFormValues, string>>

/** The order the fields appear in, which is the order focus looks for the
 *  first invalid one. */
export const ACTION_FIELD_ORDER: readonly (keyof ActionFormValues)[] = [
  'actionAt',
  'description',
  'result',
  'followUpRequired',
  'followUpNote',
  'attachmentNotes',
]

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * A moment as a `datetime-local` value: local wall-clock time, to the minute.
 *
 * Not `toISOString().slice(0, 16)`: that is UTC, and in Bangkok it would
 * offer a time seven hours before the one on the wall.
 */
export function toLocalInput(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** The `datetime-local` text as a moment, or null when it is not one. A value
 *  with no zone is read in the browser's zone, which is what the person
 *  typing it meant. */
export function fromLocalInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function emptyActionForm(now: Date = new Date()): ActionFormValues {
  return {
    // The current time, to the minute. Always accepted, including on a
    // Ticket created seconds ago, because the rule compares to the minute.
    actionAt: toLocalInput(now),
    description: '',
    result: '',
    followUpRequired: false,
    followUpNote: '',
    attachmentNotes: '',
  }
}

export function actionFormFrom(action: ActionTaken): ActionFormValues {
  return {
    actionAt: toLocalInput(new Date(action.actionAt)),
    description: action.description,
    result: action.result,
    followUpRequired: action.followUpRequired,
    followUpNote: action.followUpNote ?? '',
    attachmentNotes: action.attachmentNotes ?? '',
  }
}

export function validateActionForm(
  values: ActionFormValues,
  context: { ticketCreatedAt: string; now?: Date },
): ActionFormErrors {
  const errors: ActionFormErrors = {}
  const now = context.now ?? new Date()

  const actionAt = fromLocalInput(values.actionAt)
  if (!actionAt) {
    errors.actionAt = 'Enter the date and time the work was done.'
  } else {
    // To the minute, as the server compares it: the form cannot express the
    // seconds a Ticket was created at.
    const ticketMinute =
      Math.floor(new Date(context.ticketCreatedAt).getTime() / MINUTE) * MINUTE
    if (actionAt.getTime() < ticketMinute) {
      errors.actionAt = 'Cannot be earlier than when the Ticket was created.'
    } else if (actionAt.getTime() > now.getTime() + FUTURE_TOLERANCE) {
      errors.actionAt = 'Cannot be in the future.'
    }
  }

  const description = values.description.trim()
  if (!description) errors.description = 'Describe what was done.'
  else if (description.length > ACTION_DESCRIPTION_MAX) {
    errors.description = `Must be at most ${ACTION_DESCRIPTION_MAX} characters.`
  }

  const result = values.result.trim()
  if (!result) errors.result = 'Enter the result of the action.'
  else if (result.length > ACTION_RESULT_MAX) {
    errors.result = `Must be at most ${ACTION_RESULT_MAX} characters.`
  }

  // Only while the box is ticked. A note left in a hidden field is neither
  // checked nor sent (BR-07).
  if (values.followUpRequired) {
    const note = values.followUpNote.trim()
    if (!note) errors.followUpNote = 'Say what follow-up is needed.'
    else if (note.length > FOLLOW_UP_NOTE_MAX) {
      errors.followUpNote = `Must be at most ${FOLLOW_UP_NOTE_MAX} characters.`
    }
  }

  if (values.attachmentNotes.trim().length > ATTACHMENT_NOTES_MAX) {
    errors.attachmentNotes = `Must be at most ${ATTACHMENT_NOTES_MAX} characters.`
  }

  return errors
}

/** What is sent. Called only on a form that has passed validation. */
export function toActionInput(values: ActionFormValues): ActionTakenInput {
  return {
    actionAt: fromLocalInput(values.actionAt)!.toISOString(),
    description: values.description.trim(),
    result: values.result.trim(),
    followUpRequired: values.followUpRequired,
    followUpNote: values.followUpRequired ? values.followUpNote.trim() : null,
    attachmentNotes: values.attachmentNotes.trim() || null,
  }
}
