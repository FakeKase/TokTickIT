// Which Ticket a request is about, and whether this caller may know it exists.
//
// Shared by the comment routes and the Actions Taken routes (Lab 4), so the
// rule that a Requester sees only their own Tickets is written once.

import type { PrismaClient } from "../generated/prisma/client.js";

type Db = Pick<PrismaClient, "ticket">;

/** A transaction client: what the callback of `$transaction` is handed. */
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

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

export interface LockedTicket {
  id: number;
  currentStatus: string;
  ownerId: number | null;
  itPriority: string;
  version: number;
  createdAt: Date;
}

/**
 * The Ticket a write is about, locked until the transaction ends, or null.
 *
 * Every write the resolution gate depends on takes this lock: recording or
 * editing an Action Taken, and each change of status, owner or IT Priority.
 * Whichever of two comes second waits and then reads what the first wrote, so
 * the gate never decides while an Action Taken is half recorded, and two
 * workflow changes made from the same version cannot both succeed.
 *
 * FOR NO KEY UPDATE, not FOR UPDATE. Postgres checks the foreign key of every
 * comment, note and attachment inserted under this Ticket by taking FOR KEY
 * SHARE on it, and FOR UPDATE conflicts with that, so it would make those
 * inserts queue behind each one of these. This still conflicts with itself,
 * which is all that is needed here.
 */
export async function lockTicket(tx: Tx, id: number): Promise<LockedTicket | null> {
  const [ticket] = await tx.$queryRaw<LockedTicket[]>`
    SELECT "id", "currentStatus"::text AS "currentStatus", "ownerId",
           "itPriority"::text AS "itPriority", "version", "createdAt"
    FROM "Ticket" WHERE "id" = ${id} FOR NO KEY UPDATE`;
  return ticket ?? null;
}
