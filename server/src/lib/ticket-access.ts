// Which Ticket a request is about, and whether this caller may know it exists.
//
// Shared by the comment routes and the Actions Taken routes (Lab 4), so the
// rule that a Requester sees only their own Tickets is written once.

import type { PrismaClient } from "../generated/prisma/client.js";

type Db = Pick<PrismaClient, "ticket">;

export const TICKET_NOT_FOUND = { error: "Ticket not found" };

/** A positive integer id from a route param, or null. */
export const parseId = (raw: unknown): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/**
 * Resolves the Ticket a route is about, or null when the caller gets a 404.
 *
 * The two roles fail differently on purpose. A Requester asking about
 * somebody else's Ticket gets the same 404 as one that does not exist
 * (Lab 3 BR-18) - they must not learn it is there. Staff may read any Ticket,
 * so for them 404 means only that the id is wrong.
 */
export async function resolveTicketFor(
  db: Db,
  user: { id: number; role: string },
  // Express types a route param as string, but a wildcard route can hand
  // over an array; Number() of one is NaN, which parseId rejects.
  rawId: string | string[],
) {
  const ticketId = parseId(rawId);
  if (!ticketId) return null;

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, requesterId: true, currentStatus: true },
  });
  if (!ticket) return null;

  if (user.role === "REQUESTER" && ticket.requesterId !== user.id) return null;
  return ticket;
}
