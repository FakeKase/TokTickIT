// BR-13/BR-14/BR-15/BR-16: Create Ticket validation. The frontend validates
// the same rules for immediate feedback, but this is the source of truth —
// the backend never trusts the client (BR-16), so every rule is re-checked
// here even when the UI would have blocked the request.

export const SUMMARY_MIN = 5;
export const SUMMARY_MAX = 120;
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 2000;

export const REQUESTED_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type RequestedPriority = (typeof REQUESTED_PRIORITIES)[number];

export interface TicketInput {
  requesterId: number;
  categoryId: number;
  relatedSystemId: number;
  summary: string;
  description: string;
  requestedPriority: RequestedPriority;
}

/** Field-keyed messages, matching api-spec.md's `fields` error map. */
export type FieldErrors = Record<string, string>;

function parseId(value: unknown): number | null {
  const id = typeof value === "string" ? Number(value) : value;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

function isPriority(value: unknown): value is RequestedPriority {
  return (
    typeof value === "string" &&
    (REQUESTED_PRIORITIES as readonly string[]).includes(value)
  );
}

/**
 * Validates a Create Ticket body. Returns either the normalized input (with
 * summary/description already trimmed per BR-13/BR-14, so the caller stores
 * exactly what was validated) or the per-field messages to send back.
 *
 * `currentStatus` in the body is ignored rather than rejected: BR-02 makes it
 * server-owned, so a client that sends one simply has no effect.
 */
export function validateTicketInput(
  body: unknown,
): { ok: true; value: TicketInput } | { ok: false; fields: FieldErrors } {
  const fields: FieldErrors = {};
  const input = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;

  const requesterId = parseId(input.requesterId);
  if (requesterId === null) fields.requesterId = "A Requester must be selected.";

  const categoryId = parseId(input.categoryId);
  if (categoryId === null) fields.categoryId = "Category is required.";

  const relatedSystemId = parseId(input.relatedSystemId);
  if (relatedSystemId === null) {
    fields.relatedSystemId = "Related System is required.";
  }

  if (!isPriority(input.requestedPriority)) {
    fields.requestedPriority = "Requested Priority is required.";
  }

  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (!summary) {
    fields.summary = "Summary is required.";
  } else if (summary.length < SUMMARY_MIN) {
    fields.summary = `Summary must be at least ${SUMMARY_MIN} characters.`;
  } else if (summary.length > SUMMARY_MAX) {
    fields.summary = `Summary must be at most ${SUMMARY_MAX} characters.`;
  }

  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  if (!description) {
    fields.description = "Description is required.";
  } else if (description.length < DESCRIPTION_MIN) {
    fields.description = `Description must be at least ${DESCRIPTION_MIN} characters.`;
  } else if (description.length > DESCRIPTION_MAX) {
    fields.description = `Description must be at most ${DESCRIPTION_MAX} characters.`;
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  return {
    ok: true,
    value: {
      requesterId: requesterId!,
      categoryId: categoryId!,
      relatedSystemId: relatedSystemId!,
      summary,
      description,
      requestedPriority: input.requestedPriority as RequestedPriority,
    },
  };
}
