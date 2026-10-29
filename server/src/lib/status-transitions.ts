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

/**
 * What the resolution gate looks at (Lab 4 BR-13). Gathered by the route,
 * inside the transaction that holds the Ticket's lock, and judged here so the
 * rule itself needs no database to test.
 */
export interface GateFacts {
  hasOwner: boolean;
  actionCount: number;
  /** Follow-Up Required on the latest Action Taken, by Action Date/Time then
   *  id (BR-10). False when there is none. */
  latestRequiresFollowUp: boolean;
}

/** The two sentences Lab 4 adds. The third reason a Ticket cannot be
 *  Resolved, a missing owner, keeps its Lab 3 wording below. */
export const GATE_NO_ACTION = "Record an Action Taken before resolving this Ticket";
export const GATE_FOLLOW_UP = "The latest Action Taken still requires follow-up";

const needsOwner = (to: TicketStatusValue) =>
  `A Ticket needs a Ticket Owner before it can be ${STATUS_LABEL[to]}`;

/**
 * Why a Ticket may not be moved to Resolved, or null when it may (BR-13).
 *
 * One reason, in a fixed order: the owner, then that any work is recorded,
 * then that the latest work asks for nothing more. The order is the order a
 * person would fix them in.
 */
export function resolutionGateRefusal(facts: GateFacts): string | null {
  if (!facts.hasOwner) return needsOwner("RESOLVED");
  if (facts.actionCount === 0) return GATE_NO_ACTION;
  if (facts.latestRequiresFollowUp) return GATE_FOLLOW_UP;
  return null;
}

/**
 * Why a move that is in the matrix would still be refused right now, or null.
 *
 * Resolved answers to the whole gate. Closed needs only an owner (Lab 3
 * BR-23): the gate is not asked again on closing, so a Ticket resolved before
 * Lab 4, with no Actions Taken, can still be closed (BR-14).
 */
export function blockedReason(
  to: TicketStatusValue,
  facts: GateFacts,
): string | null {
  if (to === "RESOLVED") return resolutionGateRefusal(facts);
  if (requiresOwner(to) && !facts.hasOwner) return needsOwner(to);
  return null;
}

export interface PermittedTransition {
  to: TicketStatusValue;
  /** True when the move is in the matrix but also needs a Ticket Owner, so
   *  the screen can disable it with a reason instead of hiding it. */
  requiresOwner: boolean;
}

/** Every status reachable from `from`, in the order its row of §5.2 lists
 *  them. */
export function permittedTransitions(
  from: TicketStatusValue,
): PermittedTransition[] {
  return MATRIX[from].map((to) => ({ to, requiresOwner: requiresOwner(to) }));
}

export interface OfferedTransition extends PermittedTransition {
  /** Null when the status route would accept this move now. Otherwise the
   *  sentence it would refuse with, for the screen to show beside the
   *  disabled option. The screen does not work the gate out for itself. */
  blockedReason: string | null;
}

/** The same moves, each with whether it would be accepted at this moment
 *  (Lab 4 api-spec.md §4). This is what travels with a staff Ticket. */
export function offeredTransitions(
  from: TicketStatusValue,
  facts: GateFacts,
): OfferedTransition[] {
  return permittedTransitions(from).map((move) => ({
    ...move,
    blockedReason: blockedReason(move.to, facts),
  }));
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
  if (requiresOwner(to) && !hasOwner) return needsOwner(to);
  return null;
}

/**
 * The status route's whole decision (Lab 4 specification.md §5.2): the body
 * of the 409, or null when the move may go ahead.
 *
 * The matrix is reported first, with no code, exactly as Lab 3 worded it. A
 * move to Resolved that is in the matrix and fails the gate carries the code
 * RESOLUTION_GATE, so a client can tell "not from here" from "not yet".
 */
export function workflowRefusal(
  from: TicketStatusValue,
  to: TicketStatusValue,
  facts: GateFacts,
): { error: string; code?: string } | null {
  // Passing `true` asks the matrix alone; the owner is judged below.
  const outsideMatrix = transitionRefusal(from, to, true);
  if (outsideMatrix) return { error: outsideMatrix };

  const blocked = blockedReason(to, facts);
  if (!blocked) return null;
  return to === "RESOLVED"
    ? { error: blocked, code: "RESOLUTION_GATE" }
    : { error: blocked };
}
