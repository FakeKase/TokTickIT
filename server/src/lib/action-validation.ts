// What an Action Taken may contain (Lab 4 specification.md BR-05 to BR-07,
// BR-20). Pure: the route supplies the Ticket's creation time and the clock,
// so every boundary here can be tested without a database or a real "now".

export const ACTION_DESCRIPTION_MAX = 2000;
export const ACTION_RESULT_MAX = 1000;
export const FOLLOW_UP_NOTE_MAX = 1000;
export const ATTACHMENT_NOTES_MAX = 500;

/** How far ahead of the server clock an Action Date/Time may be. Work cannot
 *  have been done in the future; five minutes absorbs a client whose clock
 *  runs fast. */
export const ACTION_AT_FUTURE_TOLERANCE_MS = 5 * 60_000;

const MINUTE_MS = 60_000;

/** BR-20: what a request key looks like. Letters, digits and three
 *  separators, so a UUID fits and so does the seed's `seed:800002:1`. */
const REQUEST_KEY = /^[A-Za-z0-9:_-]{8,64}$/;

export const isRequestKey = (value: unknown): value is string =>
  typeof value === "string" && REQUEST_KEY.test(value);

export const REQUEST_KEY_MESSAGE =
  "Request key must be 8 to 64 letters, digits, hyphens, underscores or colons";

/**
 * An ISO 8601 date and time that says which zone it is in.
 *
 * `new Date()` alone is not the check: it accepts "2026-10-06" and "October 6",
 * and reads a time with no zone as the server's own, so the same body would
 * mean different instants on different machines.
 */
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface ActionInput {
  actionAt?: unknown;
  description?: unknown;
  result?: unknown;
  followUpRequired?: unknown;
  followUpNote?: unknown;
  attachmentNotes?: unknown;
}

export interface ActionValues {
  actionAt: Date;
  description: string;
  result: string;
  followUpRequired: boolean;
  followUpNote: string | null;
  attachmentNotes: string | null;
}

export type ActionResult =
  | { ok: true; value: ActionValues }
  | { ok: false; fields: Record<string, string> };

/** A required text field: trimmed, not empty, not over the limit. */
function requiredText(
  raw: unknown,
  max: number,
  missing: string,
): { value: string; problem?: string } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { value, problem: missing };
  if (value.length > max) {
    return { value, problem: `Must be at most ${max} characters` };
  }
  return { value };
}

/**
 * Validates the six entered fields of an Action Taken. Used by create and by
 * edit, which send the same six.
 *
 * Every failing field is reported, not only the first: the form shows them
 * all at once, and fixing one to be told about the next is a slow way to fill
 * in a form.
 */
export function validateAction(
  input: ActionInput,
  context: { ticketCreatedAt: Date; now: Date },
): ActionResult {
  const fields: Record<string, string> = {};

  const actionAt = parseInstant(input.actionAt);
  if (!actionAt) {
    fields.actionAt = "Enter the date and time the work was done";
  } else {
    // BR-05, compared to the minute. The form holds no seconds, so "now" from
    // it is the start of the current minute; against a Ticket created thirty
    // seconds ago that would be "before the Ticket existed" unless the
    // Ticket's own seconds are dropped first.
    const ticketMinute =
      Math.floor(context.ticketCreatedAt.getTime() / MINUTE_MS) * MINUTE_MS;
    if (actionAt.getTime() < ticketMinute) {
      fields.actionAt = "Cannot be earlier than when the Ticket was created";
    } else if (
      actionAt.getTime() >
      context.now.getTime() + ACTION_AT_FUTURE_TOLERANCE_MS
    ) {
      fields.actionAt = "Cannot be in the future";
    }
  }

  const description = requiredText(
    input.description,
    ACTION_DESCRIPTION_MAX,
    "Describe what was done",
  );
  if (description.problem) fields.description = description.problem;

  const result = requiredText(
    input.result,
    ACTION_RESULT_MAX,
    "Enter the result of the action",
  );
  if (result.problem) fields.result = result.problem;

  const followUpRequired = input.followUpRequired;
  if (typeof followUpRequired !== "boolean") {
    fields.followUpRequired = "Say whether follow-up is required";
  }

  // BR-07. Required with follow-up; without it the note is dropped whatever
  // was sent, so a note typed and then un-ticked cannot linger and later read
  // as though follow-up were still wanted.
  let followUpNote: string | null = null;
  if (followUpRequired === true) {
    const note = requiredText(
      input.followUpNote,
      FOLLOW_UP_NOTE_MAX,
      "Say what follow-up is needed",
    );
    if (note.problem) fields.followUpNote = note.problem;
    followUpNote = note.value;
  }

  // Optional, and empty is the same as absent (BR-06).
  let attachmentNotes: string | null = null;
  if (input.attachmentNotes !== undefined && input.attachmentNotes !== null) {
    if (typeof input.attachmentNotes !== "string") {
      fields.attachmentNotes = "Must be text";
    } else {
      const trimmed = input.attachmentNotes.trim();
      if (trimmed.length > ATTACHMENT_NOTES_MAX) {
        fields.attachmentNotes = `Must be at most ${ATTACHMENT_NOTES_MAX} characters`;
      }
      attachmentNotes = trimmed || null;
    }
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: {
      actionAt: actionAt!,
      description: description.value,
      result: result.value,
      followUpRequired: followUpRequired as boolean,
      followUpNote,
      attachmentNotes,
    },
  };
}
