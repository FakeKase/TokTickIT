// BR-22, BR-23: which status a Ticket may move to (specification.md §5.2).
//
// The enum in schema.prisma says what a status can be; this says what it may
// become. One table, read by the route that enforces it and by the response
// that tells the screen what to offer, so the two cannot drift apart: the
// client never carries its own copy of the matrix.

import { TICKET_STATUSES, type TicketStatusValue } from "./ticket-query.js";

export const STATUS_LABEL: Record<TicketStatusValue, string> = {
  NEW: "New",
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_FOR_REQUESTER: "Waiting for Requester",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
};

/** Row is the current status, the list is where it may go. Transcribed from
 *  the §5.2 table row by row; nothing leads back to New, and Cancelled leads
 *  nowhere. */
const MATRIX: Record<TicketStatusValue, readonly TicketStatusValue[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  CANCELLED: [],
};

/** BR-23: these two say the work is finished, so somebody must own having
 *  finished it. */
const NEEDS_OWNER: readonly TicketStatusValue[] = ["RESOLVED", "CLOSED"];

export const requiresOwner = (status: TicketStatusValue): boolean =>
  NEEDS_OWNER.includes(status);

export const isTicketStatus = (value: unknown): value is TicketStatusValue =>
  typeof value === "string" &&
  (TICKET_STATUSES as readonly string[]).includes(value);

export interface PermittedTransition {
  to: TicketStatusValue;
  /** True when the move is in the matrix but also needs a Ticket Owner, so
   *  the screen can disable it with a reason instead of hiding it. */
  requiresOwner: boolean;
}

/** Every status reachable from `from`, in the enum's own order. */
export function permittedTransitions(
  from: TicketStatusValue,
): PermittedTransition[] {
  return MATRIX[from].map((to) => ({ to, requiresOwner: requiresOwner(to) }));
}

/**
 * Why a move is refused, or null when it may go ahead.
 *
 * The message is written for the person at the screen (api-spec.md §12): it
 * names both statuses, because "invalid transition" sends them looking for a
 * typo when the truth is "not allowed from here".
 */
export function transitionRefusal(
  from: TicketStatusValue,
  to: TicketStatusValue,
  hasOwner: boolean,
): string | null {
  if (from === to) {
    return `This Ticket is already ${STATUS_LABEL[to]}`;
  }
  if (!MATRIX[from].includes(to)) {
    return `Cannot move a Ticket from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}`;
  }
  if (requiresOwner(to) && !hasOwner) {
    return `A Ticket needs a Ticket Owner before it can be ${STATUS_LABEL[to]}`;
  }
  return null;
}
